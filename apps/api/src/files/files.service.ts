import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { guestDocuments, payments, privateFiles, type Tx } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { LocalDiskStorage, type StorageAdapter } from '../media/storage';
import type { Env } from '../config/env';

/** A slip photo or an ID scan: images, or a PDF from a scanner. */
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);
export const MAX_PRIVATE_FILE_BYTES = 8 * 1024 * 1024;
export const FILE_PURPOSES = ['payment_slip', 'id_document', 'other'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * The private file store (Development Phase 02, Sprint 5): payment slips and ID scans.
 *
 * Separate from `media` in every way that matters. The rows are RLS-fenced (media has a public-read
 * policy for property photos), the bytes live in their own directory, and they are served only to a
 * signed-in member of the tenant, never cached. A file is attached to a payment or a document by id;
 * one already attached cannot be deleted, so a receipt never loses its slip.
 */
@Injectable()
export class FilesService {
  private readonly storage: StorageAdapter;

  constructor(
    private readonly dbs: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.storage = new LocalDiskStorage(config.get('PRIVATE_FILES_DIR', { infer: true }));
  }

  async upload(
    tenantId: string,
    userId: string | null,
    purpose: FilePurpose,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Attach a file');
    const ext = ALLOWED.get(file.mimetype);
    if (!ext)
      throw new BadRequestException('Only a photo (JPEG, PNG, WebP) or a PDF can be attached');
    if (file.size > MAX_PRIVATE_FILE_BYTES) {
      throw new BadRequestException('The file is larger than 8 MB');
    }
    // The bytes are written before the row: a row pointing at nothing would 404 forever, while a
    // file with no row (the insert failed) is an orphan a sweep can remove.
    const storageKey = `${randomBytes(16).toString('hex')}.${ext}`;
    await this.storage.save(storageKey, file.buffer);
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(privateFiles)
        .values({
          tenantId,
          storageKey,
          originalName: file.originalname.slice(0, 200),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          purpose,
          createdByUserId: userId,
        })
        .returning({
          id: privateFiles.id,
          originalName: privateFiles.originalName,
          mimeType: privateFiles.mimeType,
          sizeBytes: privateFiles.sizeBytes,
          purpose: privateFiles.purpose,
          createdAt: privateFiles.createdAt,
        });
      return row;
    });
  }

  /** The bytes, for a member of the tenant. Another tenant's id is simply not found (RLS). */
  async read(tenantId: string, id: string) {
    const row = await this.dbs.withTenant(tenantId, async (tx) => {
      const [f] = await tx.select().from(privateFiles).where(eq(privateFiles.id, id));
      return f;
    });
    if (!row) throw new NotFoundException('File not found');
    const data = await this.storage.read(row.storageKey).catch(() => null);
    if (!data) throw new NotFoundException('File not found');
    return { data, mimeType: row.mimeType, name: row.originalName };
  }

  /** Remove a file nothing refers to yet (an upload the desk changed its mind about). */
  async remove(tenantId: string, id: string) {
    const row = await this.dbs.withTenant(tenantId, async (tx) => {
      const [f] = await tx.select().from(privateFiles).where(eq(privateFiles.id, id));
      if (!f) throw new NotFoundException('File not found');
      if (await isAttached(tx, id)) {
        throw new ConflictException('This file is attached to a payment or a document and is kept');
      }
      await tx.delete(privateFiles).where(eq(privateFiles.id, id));
      return f;
    });
    await this.storage.delete(row.storageKey);
    return { id, deleted: true };
  }
}

async function isAttached(tx: Tx, id: string) {
  const [p] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.attachmentFileId, id))
    .limit(1);
  if (p) return true;
  const [d] = await tx
    .select({ id: guestDocuments.id })
    .from(guestDocuments)
    .where(eq(guestDocuments.fileId, id))
    .limit(1);
  return Boolean(d);
}

/**
 * Check that a file id is this tenant's and of the right kind, inside the caller's transaction.
 * RLS hides another tenant's file, so a foreign id is "not found" — the FK alone would accept it.
 */
export async function loadOwnFile(tx: Tx, id: string, purpose?: FilePurpose) {
  const [f] = await tx.select().from(privateFiles).where(eq(privateFiles.id, id));
  if (!f) throw new NotFoundException('Attached file not found');
  if (purpose && f.purpose !== purpose && f.purpose !== 'other') {
    throw new BadRequestException(`That file was uploaded as ${f.purpose.replace('_', ' ')}`);
  }
  return f;
}
