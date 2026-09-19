import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { customers, guestDocuments, type Tx } from '@yohobed/db';
import {
  isIdDocumentType,
  isValidIdNumber,
  normalizeIdNumber,
  normalizePhone,
  ID_DOCUMENT_LABELS,
} from '@yohobed/locale';
import type { GuestDocumentInput, GuestInput } from './dto';
import { loadOwnFile } from '../files/files.service';

export interface ResolvedGuest {
  id: string;
  name: string;
  email: string | null;
  created: boolean;
}

/**
 * The guest a booking is for: an existing one by id, or a new one.
 *
 * A new guest whose email or mobile already belongs to someone is reused only when the name
 * matches too. Otherwise the desk is asked to choose (409 `guest_exists`), because silently
 * attaching a stay to the wrong person's history is worse than a question. `line` names the room
 * whose guest it was, when it was a per-room guest. Documents given with the guest are added to
 * their profile, verified by `userId`.
 */
export async function resolveGuest(
  tx: Tx,
  tenantId: string,
  g: GuestInput,
  country: string,
  opts: { line?: number; userId?: string | null } = {},
): Promise<ResolvedGuest> {
  const { line, userId = null } = opts;
  const where = line === undefined ? '' : ` (room ${line + 1})`;
  if (g.customerId) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, g.customerId));
    if (!c) throw new NotFoundException(`Guest not found${where}`);
    if (g.documents?.length) await addDocuments(tx, tenantId, c.id, g.documents, userId);
    return { id: c.id, name: c.name, email: c.email, created: false };
  }

  const name = g.name!.trim();
  const email = g.email?.trim().toLowerCase() || null;
  const phone = g.phone ? normalizePhone(g.phone, country) : null;
  const mobileE164 = phone?.e164 ?? null;

  if (!g.createNew && (email || mobileE164)) {
    const matches = await tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(
        sql`(${email !== null ? sql`lower(${customers.email}) = ${email}` : sql`false`})
          or (${mobileE164 !== null ? sql`${customers.mobileE164} = ${mobileE164}` : sql`false`})`,
      )
      .limit(5);
    const same = matches.find((m) => sameName(m.name, name));
    if (same) {
      if (g.documents?.length) await addDocuments(tx, tenantId, same.id, g.documents, userId);
      return { id: same.id, name: same.name, email: same.email, created: false };
    }
    if (matches.length > 0) {
      throw new ConflictException({
        reason: 'guest_exists',
        message: `A guest with this email or mobile already exists under another name${where}. Pick them, or save as a new guest.`,
        candidates: matches,
        ...(line !== undefined && { line }),
      });
    }
  }

  const [c] = await tx
    .insert(customers)
    .values({
      tenantId,
      name,
      title: g.title ?? null,
      email,
      phone: g.phone ?? null,
      mobileE164,
      whatsapp: g.whatsapp ?? false,
      nationalityCode: g.nationalityCode ?? null,
      countryCode: g.countryCode ?? null,
      state: g.state ?? null,
      city: g.city ?? null,
      address: g.address ?? null,
      zip: g.zip ?? null,
      gender: g.gender ?? null,
      dateOfBirth: g.dateOfBirth ?? null,
    })
    .returning();
  if (g.documents?.length) await addDocuments(tx, tenantId, c!.id, g.documents, userId);
  return { id: c!.id, name: c!.name, email: c!.email, created: true };
}

/**
 * A document's number as it may be stored: upper-cased and trimmed, and an Aadhaar number cut
 * to its last four digits whatever was typed. A number that cannot be right is refused here,
 * at the desk, rather than discovered at check-in.
 */
export function cleanDocumentNumber(type: string, number: string): string {
  if (!isIdDocumentType(type)) throw new BadRequestException(`Unknown document type ${type}`);
  const cleaned = normalizeIdNumber(type, number);
  if (!isValidIdNumber(type, cleaned)) {
    throw new BadRequestException({
      reason: 'document_number_invalid',
      message:
        type === 'aadhaar'
          ? 'Enter the last 4 digits of the Aadhaar number'
          : `That is not a valid ${ID_DOCUMENT_LABELS[type]} number`,
    });
  }
  return cleaned;
}

export async function addDocuments(
  tx: Tx,
  tenantId: string,
  customerId: string,
  docs: GuestDocumentInput[],
  verifiedByUserId: string | null,
) {
  for (const d of docs) {
    if (d.fileId) await loadOwnFile(tx, d.fileId, 'id_document');
  }
  const rows = docs.map((d) => ({
    tenantId,
    customerId,
    type: d.type,
    number: cleanDocumentNumber(d.type, d.number),
    issuingCountry: d.issuingCountry ?? null,
    placeOfIssue: d.placeOfIssue ?? null,
    issuedOn: d.issuedOn ?? null,
    expiresOn: d.expiresOn ?? null,
    visaNumber: d.visaNumber ?? null,
    visaType: d.visaType ?? null,
    visaExpiresOn: d.visaExpiresOn ?? null,
    verification: d.verification ?? null,
    verifiedByUserId: d.verification ? verifiedByUserId : null,
    verifiedAt: d.verification ? new Date() : null,
    isPrimary: d.isPrimary ?? false,
    fileId: d.fileId ?? null,
  }));
  if (rows.length === 0) return [];
  return tx.insert(guestDocuments).values(rows).returning();
}

/** Names match ignoring case, spacing and punctuation: "D. Perera" = "d perera". */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return norm(a) === norm(b);
}
