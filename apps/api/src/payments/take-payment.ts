import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  cashDrawers,
  drawerSessions,
  ledgerAccounts,
  ledgerEntries,
  nextReceiptNo,
  paymentMethods,
  payments,
  type Tx,
} from '@yohobed/db';
import { loadOwnFile } from '../files/files.service';

/**
 * Taking money (Development Phase 02, Sprint 5) — one path for the reservation form, the folio's
 * Take Payment and the booking's payments, so a receipt number, a slip or a cash drawer is never
 * handled one way here and another way there.
 */

type LegacyMethod = 'cash' | 'card' | 'bank' | 'online';

/**
 * The hotel's own methods ("LankaQR", "Cash (USD)", "NEFT") map onto four coarse categories the
 * cashier report and the payout statement sum by. Only `cash` ever enters a drawer, so the mapping
 * of cash has to be exact; everything else is bookkeeping.
 */
export function categoryToMethod(category: string): LegacyMethod {
  switch (category) {
    case 'cash':
      return 'cash';
    case 'card':
      return 'card';
    case 'qr':
    case 'wallet':
    case 'online':
      return 'online';
    default:
      // bank_transfer, cheque, city_ledger, other
      return 'bank';
  }
}

export interface ResolvedMethod {
  id: string | null;
  code: string | null;
  name: string;
  category: string;
  method: LegacyMethod;
  requiresReference: boolean;
}

/** Load a payment method of this tenant that may be used at this property. */
export async function resolvePaymentMethod(
  tx: Tx,
  paymentMethodId: string,
  propertyId: string,
): Promise<ResolvedMethod> {
  const [m] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethodId));
  if (!m) throw new NotFoundException('Payment method not found');
  if (!m.active) throw new BadRequestException(`${m.name} is no longer offered`);
  if (m.propertyId && m.propertyId !== propertyId) {
    throw new BadRequestException(`${m.name} is not offered at this property`);
  }
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    category: m.category,
    method: categoryToMethod(m.category),
    requiresReference: m.requiresReference,
  };
}

/**
 * The till cash goes into: the shift named, or the property's open shift — the desk user's own if
 * they have one, else the most recently opened. With `required`, no open shift is a 409: cash that
 * belongs to no drawer is cash no cashier report can ever explain.
 */
export async function resolveDrawerSession(
  tx: Tx,
  args: {
    propertyId: string;
    userId: string | null;
    drawerSessionId?: string | null;
    required: boolean;
  },
): Promise<string | null> {
  if (args.drawerSessionId) {
    const [s] = await tx
      .select({
        id: drawerSessions.id,
        closedAt: drawerSessions.closedAt,
        propertyId: cashDrawers.propertyId,
      })
      .from(drawerSessions)
      .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
      .where(eq(drawerSessions.id, args.drawerSessionId));
    if (!s || s.propertyId !== args.propertyId)
      throw new NotFoundException('Drawer session not found');
    if (s.closedAt) throw new BadRequestException('That cashier shift is already closed');
    return s.id;
  }
  const open = await tx
    .select({ id: drawerSessions.id, openedBy: drawerSessions.openedByUserId })
    .from(drawerSessions)
    .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
    .where(and(eq(cashDrawers.propertyId, args.propertyId), eq(drawerSessions.status, 'open')))
    .orderBy(desc(drawerSessions.openedAt));
  const mine = open.find((s) => s.openedBy && s.openedBy === args.userId);
  const session = mine ?? open[0];
  if (!session && args.required) {
    throw new ConflictException({
      reason: 'drawer_closed',
      message: 'Open a cash drawer shift before taking cash (Cashiering → Drawers).',
    });
  }
  return session?.id ?? null;
}

export interface TakePaymentArgs {
  tenantId: string;
  propertyId: string;
  userId: string | null;
  bookingId: string;
  folioId: string | null;
  amount: number;
  currency: string;
  method: ResolvedMethod;
  reference?: string | null;
  note?: string | null;
  fileId?: string | null;
  drawerSessionId?: string | null;
  /** Rows of one split payment share the receipt. Taken from the series when omitted. */
  receiptNo?: string;
  allocationGroupId?: string | null;
  /** The hotel's date: the receipt series is per year. */
  businessDate: string;
}

/** Insert one payment row. Validation of the method and the drawer is the caller's, done once. */
export async function insertPayment(tx: Tx, a: TakePaymentArgs) {
  if (a.method.requiresReference && !a.reference?.trim()) {
    throw new BadRequestException({
      reason: 'reference_required',
      message: `${a.method.name} needs its reference number`,
    });
  }
  if (a.fileId) await loadOwnFile(tx, a.fileId, 'payment_slip');
  const receiptNo =
    a.receiptNo ??
    (await nextReceiptNo(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      date: a.businessDate,
    }));
  const [row] = await tx
    .insert(payments)
    .values({
      tenantId: a.tenantId,
      bookingId: a.bookingId,
      folioId: a.folioId,
      drawerSessionId: a.method.method === 'cash' ? (a.drawerSessionId ?? null) : null,
      direction: 'received',
      amount: a.amount.toFixed(2),
      currency: a.currency,
      method: a.method.method,
      paymentMethodId: a.method.id,
      methodCode: a.method.code,
      reference: a.reference?.trim() || null,
      note: a.note ?? null,
      takenByUserId: a.userId,
      attachmentFileId: a.fileId ?? null,
      receiptNo,
      allocationGroupId: a.allocationGroupId ?? null,
    })
    .returning();
  return row!;
}

/**
 * Move a debt to a travel agent's or company's account: the folio-clearing payment and the matching
 * ledger debit, together. Recording only one of them would lose the debt or count it twice.
 */
export async function chargeToAccountWithin(
  tx: Tx,
  a: {
    tenantId: string;
    userId: string | null;
    bookingId: string;
    folioId: string;
    ledgerAccountId: string;
    amount: number;
    currency: string;
    description: string;
    reference?: string | null;
    note?: string;
    enforceCreditLimit: boolean;
    receiptNo?: string | null;
    allocationGroupId?: string | null;
  },
) {
  const [account] = await tx
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, a.ledgerAccountId));
  if (!account) throw new NotFoundException('Ledger account not found');
  if (!account.active) throw new BadRequestException(`${account.name} is not active`);
  if (account.currency !== a.currency) {
    throw new BadRequestException(
      `${account.name} is billed in ${account.currency}, this bill is in ${a.currency}`,
    );
  }
  if (a.enforceCreditLimit && Number(account.creditLimit) > 0) {
    const entries = await tx
      .select({ direction: ledgerEntries.direction, amount: ledgerEntries.amount })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, account.id));
    const balance = entries.reduce(
      (s, e) => s + (e.direction === 'debit' ? Number(e.amount) : -Number(e.amount)),
      0,
    );
    if (balance + a.amount > Number(account.creditLimit) + 0.004) {
      throw new ConflictException({
        reason: 'credit_limit',
        message: `That would put ${account.name} at ${(balance + a.amount).toFixed(2)}, over its ${Number(account.creditLimit).toFixed(2)} credit limit`,
      });
    }
  }
  const [payment] = await tx
    .insert(payments)
    .values({
      tenantId: a.tenantId,
      bookingId: a.bookingId,
      folioId: a.folioId,
      ledgerAccountId: account.id,
      direction: 'received',
      amount: a.amount.toFixed(2),
      currency: a.currency,
      method: 'bank',
      methodCode: 'CITY_LEDGER',
      reference: a.reference ?? null,
      note: a.note ?? `Charged to ${account.name}`,
      takenByUserId: a.userId,
      receiptNo: a.receiptNo ?? null,
      allocationGroupId: a.allocationGroupId ?? null,
    })
    .returning();
  await tx.insert(ledgerEntries).values({
    tenantId: a.tenantId,
    accountId: account.id,
    direction: 'debit',
    amount: a.amount.toFixed(2),
    currency: a.currency,
    description: a.description,
    bookingId: a.bookingId,
    folioId: a.folioId,
    reference: a.reference ?? null,
    postedByUserId: a.userId,
  });
  return { payment: payment!, account };
}

/** City ledger is a Pro feature; say so plainly rather than with a bare 403. */
export function assertCityLedger(enabled: boolean) {
  if (!enabled) {
    throw new ForbiddenException(
      'Billing a travel agent or company is part of the Pro plan (city ledger). Upgrade to enable it.',
    );
  }
}
