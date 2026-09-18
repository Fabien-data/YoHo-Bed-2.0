import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { bookings, customers, properties, type Tx } from '@yohobed/db';
import { normalizePhone } from '@yohobed/locale';
import { DatabaseService } from '../database/database.service';
import type { CreateCustomerDto, SearchCustomersDto, UpdateCustomerDto } from './dto';
import { resolveAggCurrency } from '../common/currency';

/**
 * Customer directory (Compartment I): every guest the property has ever hosted, with their
 * booking history and value — the CRM view the legacy extranet never had a screen for.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // Spend folds per customer, not per tenant: one guest may have stayed at an LKR property and
      // a USD one, while the guest beside them stayed only at the LKR one. So each row carries the
      // set of currencies its own bookings used, and is denominated independently.
      const confirmed = sql`${bookings.status} in ('Approved','CheckedIn','CheckedOut')`;
      const rows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          email: customers.email,
          phone: customers.phone,
          nationality: customers.nationality,
          country: customers.country,
          vip: customers.vip,
          firstSeen: customers.createdAt,
          bookings: sql<number>`count(${bookings.id})::int`,
          nights: sql<number>`coalesce(sum(${bookings.nights}) filter (where ${bookings.status} not in ('Cancelled','Rejected')), 0)::int`,
          spend: sql<string>`coalesce(sum(${bookings.amount}) filter (where ${confirmed}), 0)::text`,
          spendLkr: sql<string>`coalesce(sum(${bookings.amount} * ${bookings.fxRateToLkr}) filter (where ${confirmed}), 0)::text`,
          currencies: sql<
            string[]
          >`coalesce(array_agg(distinct ${bookings.currency}) filter (where ${confirmed}), '{}')`,
          lastCheckin: sql<string | null>`max(${bookings.checkin})`,
        })
        .from(customers)
        .leftJoin(bookings, eq(bookings.customerId, customers.id))
        .groupBy(customers.id)
        .orderBy(desc(customers.createdAt));

      return rows.map(({ spend, spendLkr, currencies, ...c }) => {
        const agg = resolveAggCurrency(currencies);
        return {
          ...c,
          totalSpend: agg.approximate ? spendLkr : spend,
          currency: agg.currency,
          approximate: agg.approximate,
        };
      });
    });
  }

  /**
   * Find a returning guest as the desk types (Development Phase 02): by name, email, or any part
   * of a phone number however it was written ("077 123 4567", "+94771234567", "771234567").
   * Names that start with the search come first, then the most recent guests.
   */
  search(tenantId: string, q: SearchCustomersDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const term = q.q.trim();
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const digits = term.replace(/\D/g, '');
      // A local number typed with its leading zero ("0771…") is stored as +94771…: drop it.
      const phoneDigits = digits.replace(/^0+/, '');
      const phoneMatch =
        phoneDigits.length >= 4
          ? sql`or regexp_replace(coalesce(${customers.mobileE164}, ${customers.phone}, ''), '\\D', '', 'g') like ${`%${phoneDigits}%`}`
          : sql``;

      return tx
        .select({
          id: customers.id,
          title: customers.title,
          name: customers.name,
          email: customers.email,
          phone: customers.phone,
          mobileE164: customers.mobileE164,
          whatsapp: customers.whatsapp,
          nationalityCode: customers.nationalityCode,
          countryCode: customers.countryCode,
          vip: customers.vip,
          stays: sql<number>`(
            select count(*)::int from bookings b
            where b.customer_id = customers.id and b.status not in ('Cancelled', 'Rejected')
          )`,
          lastStay: sql<string | null>`(
            select max(b.checkin)::text from bookings b
            where b.customer_id = customers.id and b.status not in ('Cancelled', 'Rejected')
          )`,
        })
        .from(customers)
        .where(
          sql`(${customers.name} ilike ${like} or ${customers.email} ilike ${like} ${phoneMatch})`,
        )
        .orderBy(
          sql`case when ${customers.name} ilike ${`${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} then 0 else 1 end`,
          desc(customers.updatedAt),
          asc(customers.name),
        )
        .limit(q.limit);
    });
  }

  /**
   * Add a guest. A guest whose email or mobile already belongs to someone is refused with the
   * matches, so the desk can pick the existing record instead of splitting a guest's history —
   * unless it says `createNew`.
   */
  create(tenantId: string, dto: CreateCustomerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const { createNew, consentVersion, ...fields } = dto;
      const email = fields.email?.trim().toLowerCase() || null;
      const mobileE164 = await this.e164(tx, fields.phone);

      if (!createNew && (email || mobileE164)) {
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
        if (matches.length > 0) {
          throw new ConflictException({
            reason: 'guest_exists',
            message: 'A guest with this email or mobile already exists.',
            candidates: matches,
          });
        }
      }

      const [created] = await tx
        .insert(customers)
        .values({
          ...fields,
          tenantId,
          email,
          mobileE164,
          ...(consentVersion && { consentVersion, consentAt: new Date() }),
        })
        .returning();
      return created;
    });
  }

  get(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) throw new NotFoundException('Customer not found');
      const history = await tx
        .select({
          id: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
          reservationKind: bookings.reservationKind,
          source: bookings.source,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          nights: bookings.nights,
          rooms: bookings.rooms,
          amount: bookings.amount,
          currency: bookings.currency,
        })
        .from(bookings)
        .where(eq(bookings.customerId, id))
        .orderBy(desc(bookings.createdAt));
      return { ...customer, history };
    });
  }

  /** Edit a guest's profile — the fields the registration card and reporting need. */
  update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [existing] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!existing) throw new NotFoundException('Customer not found');
      const { consentVersion, ...fields } = dto;
      const [updated] = await tx
        .update(customers)
        .set({
          ...fields,
          ...(fields.email !== undefined && { email: fields.email?.toLowerCase() ?? null }),
          ...(fields.phone !== undefined && { mobileE164: await this.e164(tx, fields.phone) }),
          ...(consentVersion !== undefined &&
            (consentVersion
              ? { consentVersion, consentAt: new Date() }
              : { consentVersion: null, consentAt: null })),
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning();
      return updated;
    });
  }

  /** A phone as E.164, read in the tenant's home country when it has no country prefix. */
  private async e164(tx: Tx, phone: string | null | undefined): Promise<string | null> {
    if (!phone) return null;
    const [home] = await tx
      .select({ countryCode: properties.countryCode })
      .from(properties)
      .orderBy(asc(properties.createdAt))
      .limit(1);
    return normalizePhone(phone, home?.countryCode ?? 'LK')?.e164 ?? null;
  }
}
