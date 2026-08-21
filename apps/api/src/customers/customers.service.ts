import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { bookings, customers } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { UpdateCustomerDto } from './dto';
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

  get(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) throw new NotFoundException('Customer not found');
      const history = await tx
        .select({
          id: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
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
      const [updated] = await tx
        .update(customers)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning();
      return updated;
    });
  }
}
