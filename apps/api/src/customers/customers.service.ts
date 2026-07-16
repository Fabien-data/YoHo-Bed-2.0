import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { bookings, customers } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';

/**
 * Customer directory (Compartment I): every guest the property has ever hosted, with their
 * booking history and value — the CRM view the legacy extranet never had a screen for.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: customers.id,
          name: customers.name,
          email: customers.email,
          phone: customers.phone,
          firstSeen: customers.createdAt,
          bookings: sql<number>`count(${bookings.id})::int`,
          nights: sql<number>`coalesce(sum(${bookings.nights}) filter (where ${bookings.status} not in ('Cancelled','Rejected')), 0)::int`,
          totalSpend: sql<string>`coalesce(sum(${bookings.amount}) filter (where ${bookings.status} in ('Approved','CheckedIn','CheckedOut')), 0)::text`,
          lastCheckin: sql<string | null>`max(${bookings.checkin})`,
        })
        .from(customers)
        .leftJoin(bookings, eq(bookings.customerId, customers.id))
        .groupBy(customers.id)
        .orderBy(desc(customers.createdAt)),
    );
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
        })
        .from(bookings)
        .where(eq(bookings.customerId, id))
        .orderBy(desc(bookings.createdAt));
      return { ...customer, history };
    });
  }
}
