import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  cashDrawers,
  drawerSessions,
  expenseVouchers,
  folios,
  ledgerAccounts,
  ledgerEntries,
  payments,
  properties,
  users,
  type Tx,
  payoutTypes,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type {
  ChargeToLedgerDto,
  CloseDrawerDto,
  CreateDrawerDto,
  CreateExpenseDto,
  CreateLedgerAccountDto,
  OpenDrawerDto,
  SettleLedgerDto,
} from './dto';

const money = (n: number) => n.toFixed(2);

@Injectable()
export class CashieringService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- City ledger -----------------------------------------------------------

  /**
   * Every account with its balance.
   *
   * The balance is summed from the entries, never stored: a stored balance and its entries are two
   * answers to the same question, and they drift the first time anything is back-dated.
   */
  listAccounts(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: ledgerAccounts.id,
          type: ledgerAccounts.type,
          code: ledgerAccounts.code,
          name: ledgerAccounts.name,
          contactName: ledgerAccounts.contactName,
          email: ledgerAccounts.email,
          phone: ledgerAccounts.phone,
          creditLimit: ledgerAccounts.creditLimit,
          currency: ledgerAccounts.currency,
          active: ledgerAccounts.active,
          // The correlation is written out in full on purpose. Interpolating the Drizzle column
          // here renders a BARE `"id"`, because this is the projection of a single-table select
          // and Drizzle only qualifies columns when the query has a join. Postgres then resolves
          // `"id"` against the INNER table, so `e.account_id = e.id` never matches and every
          // balance silently reads 0 — no error, just a wrong number on every account.
          balance: sql<string>`coalesce((
            select sum(case when e.direction = 'debit' then e.amount else -e.amount end)
            from ledger_entries e where e.account_id = ledger_accounts.id
          ), 0)::text`,
        })
        .from(ledgerAccounts)
        .orderBy(asc(ledgerAccounts.type), asc(ledgerAccounts.name)),
    );
  }

  createAccount(tenantId: string, dto: CreateLedgerAccountDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // Default the account's currency to the property it belongs to. A hardcoded 'LKR' default
      // made every account on a USD-base property un-billable — chargeToLedger refuses a
      // currency mismatch, correctly.
      const property = dto.propertyId ? await this.loadProperty(tx, dto.propertyId) : null;
      const currency = dto.currency ?? property?.currency ?? 'LKR';
      try {
        const [created] = await tx
          .insert(ledgerAccounts)
          .values({
            tenantId,
            propertyId: dto.propertyId ?? null,
            type: dto.type,
            code: dto.code,
            name: dto.name,
            contactName: dto.contactName ?? null,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            address: dto.address ?? null,
            taxId: dto.taxId ?? null,
            creditLimit: money(dto.creditLimit),
            currency,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`An account with code "${dto.code}" already exists`);
        }
        throw e;
      }
    });
  }

  /** An account's statement: every entry, newest first, with its running balance. */
  statement(tenantId: string, accountId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const account = await this.loadAccount(tx, accountId);
      const entries = await tx
        .select({
          id: ledgerEntries.id,
          direction: ledgerEntries.direction,
          amount: ledgerEntries.amount,
          description: ledgerEntries.description,
          reference: ledgerEntries.reference,
          bookingId: ledgerEntries.bookingId,
          createdAt: ledgerEntries.createdAt,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.accountId, accountId))
        .orderBy(asc(ledgerEntries.createdAt));

      let running = 0;
      const withBalance = entries.map((e) => {
        running += e.direction === 'debit' ? Number(e.amount) : -Number(e.amount);
        return { ...e, balance: money(running) };
      });

      return { account, balance: money(running), entries: withBalance.reverse() };
    });
  }

  /**
   * "Charge to company": clear the folio and move the debt to a ledger account.
   *
   * This is not a payment in the sense of money arriving — it is a transfer of who owes it. It
   * writes both sides in one transaction: the folio-clearing `payments` row and the matching
   * ledger debit. Recording only one of them would either lose the debt or double-count it.
   */
  async chargeToLedger(
    tenantId: string,
    folioId: string,
    userId: string | null,
    dto: ChargeToLedgerDto,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [folio] = await tx.select().from(folios).where(eq(folios.id, folioId));
      if (!folio) throw new NotFoundException('Folio not found');
      if (folio.status !== 'open') throw new BadRequestException(`This window is ${folio.status}`);

      const account = await this.loadAccount(tx, dto.ledgerAccountId);
      if (!account.active) throw new BadRequestException(`${account.name} is not active`);
      if (account.currency !== folio.currency) {
        throw new BadRequestException(
          `${account.name} is billed in ${account.currency}, this folio is in ${folio.currency}`,
        );
      }

      // A credit limit of 0 means "no limit"; anything else is enforced here rather than left to
      // the front desk to remember.
      const limit = Number(account.creditLimit);
      if (limit > 0) {
        const balance = await this.balanceOf(tx, account.id);
        if (balance + dto.amount > limit) {
          throw new ConflictException(
            `That would put ${account.name} at ${money(balance + dto.amount)}, over its ${money(limit)} credit limit`,
          );
        }
      }

      const [payment] = await tx
        .insert(payments)
        .values({
          tenantId,
          bookingId: folio.bookingId,
          folioId: folio.id,
          ledgerAccountId: account.id,
          direction: 'received',
          amount: money(dto.amount),
          currency: folio.currency,
          method: 'bank',
          reference: dto.reference ?? null,
          note: `Charged to ${account.name}`,
        })
        .returning();

      await tx.insert(ledgerEntries).values({
        tenantId,
        accountId: account.id,
        direction: 'debit',
        amount: money(dto.amount),
        currency: folio.currency,
        description: dto.description ?? `Folio ${folio.window} — booking charge`,
        bookingId: folio.bookingId,
        folioId: folio.id,
        reference: dto.reference ?? null,
        postedByUserId: userId,
      });

      return payment;
    });
  }

  /** The account pays us — a credit against the balance. */
  settleLedger(tenantId: string, accountId: string, userId: string | null, dto: SettleLedgerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const account = await this.loadAccount(tx, accountId);
      const [entry] = await tx
        .insert(ledgerEntries)
        .values({
          tenantId,
          accountId: account.id,
          direction: 'credit',
          amount: money(dto.amount),
          currency: account.currency,
          description: dto.description ?? 'Payment received',
          reference: dto.reference ?? null,
          postedByUserId: userId,
        })
        .returning();
      return entry;
    });
  }

  // --- Drawers ---------------------------------------------------------------

  listDrawers(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: cashDrawers.id,
          name: cashDrawers.name,
          active: cashDrawers.active,
          // Written out in full for the same reason as the ledger balance above.
          openSessionId: sql<string | null>`(
            select s.id from drawer_sessions s
            where s.drawer_id = cash_drawers.id and s.status = 'open' limit 1
          )`,
        })
        .from(cashDrawers)
        .where(eq(cashDrawers.propertyId, propertyId))
        .orderBy(asc(cashDrawers.name)),
    );
  }

  createDrawer(tenantId: string, propertyId: string, dto: CreateDrawerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // The URL propertyId must be one of OURS: RLS's WITH CHECK only tests tenant_id and FK
      // validation bypasses RLS, so an unchecked insert would happily hang a drawer off another
      // tenant's property.
      await this.loadProperty(tx, propertyId);
      try {
        const [created] = await tx
          .insert(cashDrawers)
          .values({ tenantId, propertyId, name: dto.name })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`A drawer called "${dto.name}" already exists here`);
        }
        throw e;
      }
    });
  }

  /**
   * Start a shift.
   *
   * A partial unique index allows only one open session per drawer — two cashiers on one till
   * means neither of them reconciles, so the database refuses it rather than trusting the UI.
   */
  async openSession(tenantId: string, drawerId: string, userId: string | null, dto: OpenDrawerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [drawer] = await tx.select().from(cashDrawers).where(eq(cashDrawers.id, drawerId));
      if (!drawer) throw new NotFoundException('Drawer not found');
      if (!drawer.active) throw new BadRequestException('That drawer is not in service');

      try {
        const [created] = await tx
          .insert(drawerSessions)
          .values({
            tenantId,
            drawerId,
            openingFloat: money(dto.openingFloat),
            openedByUserId: userId,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException('That drawer already has an open shift');
        }
        throw e;
      }
    });
  }

  /**
   * What the till should hold right now: the float, plus cash taken, minus cash paid out.
   *
   * Only **cash** counts. A card payment never entered the drawer, so including it would make
   * every shift look short by the day's card takings.
   */
  private async expectedFor(tx: Tx, session: typeof drawerSessions.$inferSelect) {
    const [taken] = await tx
      .select({
        cash: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'cash'), 0)::text`,
        all: sql<string>`coalesce(sum(${payments.amount}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(and(eq(payments.drawerSessionId, session.id), eq(payments.direction, 'received')));

    const [spent] = await tx
      .select({
        cash: sql<string>`coalesce(sum(${expenseVouchers.amount}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(expenseVouchers)
      .where(eq(expenseVouchers.drawerSessionId, session.id));

    // Cash handed back to guests from this till (refunds, UX-1b) leaves it like an expense.
    const [refunded] = await tx
      .select({
        cash: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'cash'), 0)::text`,
      })
      .from(payments)
      .where(and(eq(payments.drawerSessionId, session.id), eq(payments.direction, 'sent')));

    const float = Number(session.openingFloat);
    const cashIn = Number(taken?.cash ?? 0);
    const cashOut = Number(spent?.cash ?? 0) + Number(refunded?.cash ?? 0);

    return {
      openingFloat: money(float),
      cashTaken: money(cashIn),
      cashPaidOut: money(cashOut),
      expected: money(float + cashIn - cashOut),
      allPaymentsTaken: money(Number(taken?.all ?? 0)),
      paymentCount: taken?.n ?? 0,
      expenseCount: spent?.n ?? 0,
    };
  }

  /** The Cashier Report for a shift — live while open, frozen once closed. */
  report(tenantId: string, sessionId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const session = await this.loadSession(tx, sessionId, { mustBeOpen: false });
      const totals = await this.expectedFor(tx, session);

      const byMethod = await tx
        .select({
          method: payments.method,
          total: sql<string>`sum(${payments.amount})::text`,
          n: sql<number>`count(*)::int`,
        })
        .from(payments)
        .where(and(eq(payments.drawerSessionId, sessionId), eq(payments.direction, 'received')))
        .groupBy(payments.method);

      const expenses = await tx
        .select({
          id: expenseVouchers.id,
          voucherNo: expenseVouchers.voucherNo,
          category: expenseVouchers.category,
          payee: expenseVouchers.payee,
          amount: expenseVouchers.amount,
          createdAt: expenseVouchers.createdAt,
        })
        .from(expenseVouchers)
        .where(eq(expenseVouchers.drawerSessionId, sessionId))
        .orderBy(desc(expenseVouchers.createdAt));

      return {
        session,
        totals:
          session.status === 'closed'
            ? {
                ...totals,
                // Once closed the numbers are the ones the cashier was held to, not today's recount.
                expected: session.expectedTotal ?? totals.expected,
                declared: session.declaredTotal,
                variance: session.variance,
              }
            : totals,
        byMethod,
        expenses,
      };
    });
  }

  /**
   * Close the shift.
   *
   * The variance is computed here and **frozen** on the row. Recomputing it later from live data
   * would quietly rewrite history the moment a back-dated payment lands on the shift.
   */
  async closeSession(
    tenantId: string,
    sessionId: string,
    userId: string | null,
    dto: CloseDrawerDto,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const session = await this.loadSession(tx, sessionId, { mustBeOpen: true });
      const totals = await this.expectedFor(tx, session);
      const expected = Number(totals.expected);
      const variance = dto.declaredTotal - expected;

      const [closed] = await tx
        .update(drawerSessions)
        .set({
          status: 'closed',
          declaredTotal: money(dto.declaredTotal),
          expectedTotal: money(expected),
          variance: money(variance),
          closedByUserId: userId,
          closedAt: new Date(),
          notes: dto.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(drawerSessions.id, sessionId))
        .returning();

      return { ...closed!, expectedBreakdown: totals };
    });
  }

  // --- Expenses --------------------------------------------------------------

  listExpenses(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: expenseVouchers.id,
          voucherNo: expenseVouchers.voucherNo,
          category: expenseVouchers.category,
          payee: expenseVouchers.payee,
          amount: expenseVouchers.amount,
          currency: expenseVouchers.currency,
          reference: expenseVouchers.reference,
          note: expenseVouchers.note,
          drawerSessionId: expenseVouchers.drawerSessionId,
          createdAt: expenseVouchers.createdAt,
          createdBy: users.name,
        })
        .from(expenseVouchers)
        .leftJoin(users, eq(users.id, expenseVouchers.createdByUserId))
        .where(eq(expenseVouchers.propertyId, propertyId))
        .orderBy(desc(expenseVouchers.createdAt)),
    );
  }

  createExpense(
    tenantId: string,
    propertyId: string,
    userId: string | null,
    dto: CreateExpenseDto,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const property = await this.loadProperty(tx, propertyId);
      if (dto.drawerSessionId) {
        const session = await this.loadSession(tx, dto.drawerSessionId, { mustBeOpen: true });
        // The till must belong to THIS property — otherwise property A's expense silently
        // drains property B's drawer and neither cashier report reconciles.
        const [drawer] = await tx
          .select({ propertyId: cashDrawers.propertyId })
          .from(cashDrawers)
          .where(eq(cashDrawers.id, session.drawerId));
        if (drawer?.propertyId !== propertyId) {
          throw new BadRequestException('That drawer shift belongs to a different property');
        }
      }
      // A payout reason carries its own category, so the reports group it where the hotel meant.
      let category = dto.category;
      if (dto.payoutTypeId) {
        const [payout] = await tx
          .select({ category: payoutTypes.category, active: payoutTypes.active })
          .from(payoutTypes)
          .where(eq(payoutTypes.id, dto.payoutTypeId));
        if (!payout) throw new NotFoundException('Payout reason not found');
        category = payout.category as typeof category;
      }
      const voucherNo = dto.voucherNo ?? (await this.nextVoucherNo(tx, propertyId));
      try {
        const [created] = await tx
          .insert(expenseVouchers)
          .values({
            tenantId,
            propertyId,
            drawerSessionId: dto.drawerSessionId ?? null,
            voucherNo,
            category,
            payoutTypeId: dto.payoutTypeId ?? null,
            payee: dto.payee,
            amount: money(dto.amount),
            currency: dto.currency ?? property.currency,
            reference: dto.reference ?? null,
            note: dto.note ?? null,
            createdByUserId: userId,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`Voucher "${voucherNo}" already exists`);
        }
        throw e;
      }
    });
  }

  // --- helpers ---------------------------------------------------------------

  private async loadAccount(tx: Tx, id: string) {
    const [a] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
    if (!a) throw new NotFoundException('Ledger account not found');
    return a;
  }

  /** RLS makes a foreign property invisible, so this lookup doubles as the ownership check. */
  private async loadProperty(tx: Tx, id: string) {
    const [p] = await tx.select().from(properties).where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }

  private async balanceOf(tx: Tx, accountId: string): Promise<number> {
    const [row] = await tx
      .select({
        balance: sql<string>`coalesce(sum(case when ${ledgerEntries.direction} = 'debit' then ${ledgerEntries.amount} else -${ledgerEntries.amount} end), 0)::text`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
    return Number(row?.balance ?? 0);
  }

  private async loadSession(tx: Tx, id: string, opts: { mustBeOpen: boolean }) {
    const [s] = await tx.select().from(drawerSessions).where(eq(drawerSessions.id, id));
    if (!s) throw new NotFoundException('Drawer shift not found');
    if (opts.mustBeOpen && s.status !== 'open') {
      throw new BadRequestException('That shift is already closed');
    }
    return s;
  }

  private async nextVoucherNo(tx: Tx, propertyId: string): Promise<string> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(expenseVouchers)
      .where(eq(expenseVouchers.propertyId, propertyId));
    return `EV-${String((row?.n ?? 0) + 1).padStart(5, '0')}`;
  }

  /**
   * Force-close every open shift on a property. Used by night audit, which cannot roll the
   * business date while a till is still open.
   */
  static async forceCloseOpenSessions(
    tx: Tx,
    propertyId: string,
    userId: string | null,
  ): Promise<number> {
    const open = await tx
      .select({ id: drawerSessions.id, openingFloat: drawerSessions.openingFloat })
      .from(drawerSessions)
      .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
      .where(and(eq(cashDrawers.propertyId, propertyId), eq(drawerSessions.status, 'open')));

    for (const s of open) {
      // Nobody counted this till, so it is closed UNCOUNTED: the declared total and the variance
      // stay empty (UX-1a). It used to record declared = expected, variance 0 — which reads, in
      // every report, exactly like a till that was counted and balanced, hiding any shortfall.
      const [row] = await tx
        .select({
          // Cash in, less cash refunded from this till (UX-1b).
          cash: sql<string>`coalesce((
            select sum(case when p.direction = 'received' then p.amount else -p.amount end)
            from payments p
            where p.drawer_session_id = ${s.id} and p.method = 'cash'
          ), 0)::text`,
          out: sql<string>`coalesce((
            select sum(e.amount) from expense_vouchers e where e.drawer_session_id = ${s.id}
          ), 0)::text`,
        })
        .from(drawerSessions)
        .where(eq(drawerSessions.id, s.id));
      const expected = Number(s.openingFloat) + Number(row?.cash ?? 0) - Number(row?.out ?? 0);

      await tx
        .update(drawerSessions)
        .set({
          status: 'closed',
          expectedTotal: money(expected),
          declaredTotal: null,
          variance: null,
          closedByUserId: userId,
          closedAt: new Date(),
          notes: 'Closed uncounted by night audit',
          updatedAt: new Date(),
        })
        .where(eq(drawerSessions.id, s.id));
    }
    return open.length;
  }
}
