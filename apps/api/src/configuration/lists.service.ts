import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  customerAttributes,
  customers,
  discounts,
  guestAttributes,
  holidays,
  payoutTypes,
  properties,
  remarkTemplates,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { PROPERTY_LISTS, type ListKey } from './lists.dto';

/* eslint-disable @typescript-eslint/no-explicit-any -- one code path over five tables whose rows
   the zod schemas have already shaped; each table is still named explicitly below. */
type AnyTable =
  | typeof holidays
  | typeof guestAttributes
  | typeof discounts
  | typeof remarkTemplates
  | typeof payoutTypes;

const TABLES: Record<ListKey, AnyTable> = {
  holidays,
  'guest-attributes': guestAttributes,
  discounts,
  remarks: remarkTemplates,
  'payout-types': payoutTypes,
};

const NOUN: Record<ListKey, string> = {
  holidays: 'Holiday',
  'guest-attributes': 'Guest attribute',
  discounts: 'Discount',
  remarks: 'Saved remark',
  'payout-types': 'Payout',
};

/** Each list in the order its screen and its pickers show it. */
function orderOf(key: ListKey): SQL[] {
  switch (key) {
    case 'holidays':
      return [asc(holidays.date), asc(holidays.name)];
    case 'guest-attributes':
      return [asc(guestAttributes.sort), asc(guestAttributes.name)];
    case 'discounts':
      return [asc(discounts.sort), asc(discounts.name)];
    case 'remarks':
      return [asc(remarkTemplates.type), asc(remarkTemplates.sort), asc(remarkTemplates.text)];
    case 'payout-types':
      return [asc(payoutTypes.sort), asc(payoutTypes.name)];
  }
}

/** What a duplicate means, in the words of the list. */
function duplicateMessage(key: ListKey, body: Record<string, unknown>): string {
  switch (key) {
    case 'holidays':
      return `"${body.name}" is already on ${body.date}`;
    case 'guest-attributes':
      return `There is already an attribute called "${body.name}"`;
    case 'discounts':
      return `Another discount already uses the code ${body.code}`;
    case 'payout-types':
      return `Another payout already uses the code ${body.code}`;
    default:
      return 'That entry already exists';
  }
}

function rethrow(e: unknown, key: ListKey, body: Record<string, unknown>): never {
  const pg = (e as { code?: string; cause?: { code?: string } }) ?? {};
  const code = pg.code ?? pg.cause?.code;
  if (code === '23505') throw new ConflictException(duplicateMessage(key, body));
  if (code === '23514') throw new BadRequestException('That value is not allowed here');
  throw e;
}

/** A discount's value is money: stored as two decimals. */
function toRow(key: ListKey, body: Record<string, any>): Record<string, any> {
  if (key === 'discounts' && typeof body.value === 'number')
    return { ...body, value: body.value.toFixed(2) };
  return body;
}

/**
 * Configuration's short lists (owner brief, 2026-09-26): Holidays, Guest attributes, Discounts,
 * saved Remarks and Payouts. Everyone in the hotel reads them — the desk picks from them — and
 * only the owner changes them (the controller's guard).
 */
@Injectable()
export class ListsService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string, key: ListKey, propertyId?: string) {
    const table = TABLES[key] as any;
    const scoped = PROPERTY_LISTS.has(key);
    if (scoped && !propertyId) throw new BadRequestException('Say which property (propertyId)');
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(table)
        .where(scoped ? eq(table.propertyId, propertyId!) : undefined)
        .orderBy(...orderOf(key)),
    );
  }

  create(tenantId: string, key: ListKey, body: Record<string, any>, propertyId?: string) {
    const table = TABLES[key] as any;
    const scoped = PROPERTY_LISTS.has(key);
    if (scoped && !propertyId) throw new BadRequestException('Say which property (propertyId)');
    return this.dbs.withTenant(tenantId, async (tx) => {
      if (scoped) await this.assertProperty(tx, propertyId!);
      let sortValue = body.sort;
      if ('sort' in table && sortValue === undefined) {
        const [last] = await tx
          .select({ max: sql<number>`coalesce(max(${table.sort}), 0)::int` })
          .from(table)
          .where(scoped ? eq(table.propertyId, propertyId!) : undefined);
        sortValue = (last?.max ?? 0) + 10;
      }
      try {
        const [row] = await tx
          .insert(table)
          .values({
            tenantId,
            ...(scoped ? { propertyId } : {}),
            ...toRow(key, body),
            ...('sort' in table ? { sort: sortValue } : {}),
          })
          .returning();
        return row;
      } catch (e) {
        rethrow(e, key, body);
      }
    });
  }

  update(tenantId: string, key: ListKey, id: string, body: Record<string, any>) {
    const table = TABLES[key] as any;
    if (Object.keys(body).length === 0) throw new BadRequestException('Nothing to change');
    return this.dbs.withTenant(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .update(table)
          .set({ ...toRow(key, body), updatedAt: new Date() })
          .where(eq(table.id, id))
          .returning();
        if (!row) throw new NotFoundException(`${NOUN[key]} not found`);
        return row;
      } catch (e) {
        if (e instanceof NotFoundException) throw e;
        rethrow(e, key, body);
      }
    });
  }

  /**
   * Delete an entry. Nothing is lost that matters: a guest keeps their stays when an attribute
   * goes, an expense keeps its category when its payout type goes, and a stay keeps the price a
   * discount gave it.
   */
  remove(tenantId: string, key: ListKey, id: string) {
    const table = TABLES[key] as any;
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id });
      if (!row) throw new NotFoundException(`${NOUN[key]} not found`);
      return { deleted: true, id };
    });
  }

  /**
   * The holidays falling in [from, to], each yearly one on every year it falls in — for Stay
   * View's header and the rates calendar.
   */
  holidaysBetween(tenantId: string, propertyId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(holidays).where(eq(holidays.propertyId, propertyId));
      const out: Array<{ id: string; date: string; name: string; recurring: boolean }> = [];
      const fromYear = Number(from.slice(0, 4));
      const toYear = Number(to.slice(0, 4));
      for (const h of rows) {
        const dates = h.recurring
          ? Array.from({ length: toYear - fromYear + 1 }, (_, i) => onYear(h.date, fromYear + i))
          : [h.date];
        for (const date of dates)
          if (date && date >= from && date <= to)
            out.push({ id: h.id, date, name: h.name, recurring: h.recurring });
      }
      return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    });
  }

  /** A guest's attributes, in the hotel's order. */
  attributesOf(tenantId: string, customerId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.attributesWithin(tx, customerId));
  }

  /** Set exactly which attributes a guest carries. */
  setAttributes(tenantId: string, customerId: string, attributeIds: string[]) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [guest] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, customerId));
      if (!guest) throw new NotFoundException('Guest not found');
      const ids = [...new Set(attributeIds)];
      if (ids.length) {
        const known = await tx
          .select({ id: guestAttributes.id })
          .from(guestAttributes)
          .where(inArray(guestAttributes.id, ids));
        if (known.length !== ids.length) throw new NotFoundException('Guest attribute not found');
      }
      await tx.delete(customerAttributes).where(eq(customerAttributes.customerId, customerId));
      if (ids.length)
        await tx
          .insert(customerAttributes)
          .values(ids.map((attributeId) => ({ tenantId, customerId, attributeId })));
      return this.attributesWithin(tx, customerId);
    });
  }

  private attributesWithin(tx: Tx, customerId: string) {
    return tx
      .select({
        id: guestAttributes.id,
        name: guestAttributes.name,
        color: guestAttributes.color,
        description: guestAttributes.description,
      })
      .from(customerAttributes)
      .innerJoin(guestAttributes, eq(guestAttributes.id, customerAttributes.attributeId))
      .where(and(eq(customerAttributes.customerId, customerId)))
      .orderBy(asc(guestAttributes.sort), asc(guestAttributes.name));
  }

  private async assertProperty(tx: Tx, propertyId: string) {
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!p) throw new NotFoundException('Property not found');
  }
}

/** A yearly date in another year — 29 February falls on 28 February when there is none. */
function onYear(date: string, year: number): string | null {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  const candidate = new Date(Date.UTC(year, m - 1, d));
  if (candidate.getUTCMonth() !== m - 1) candidate.setUTCDate(0);
  return candidate.toISOString().slice(0, 10);
}
