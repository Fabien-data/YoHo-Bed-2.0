'use client';

import * as React from 'react';
import { ArrowRight, Lock, ShieldCheck } from '@phosphor-icons/react';
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  InlineAlert,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TagDot,
  cn,
  type ComboboxOption,
} from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import type { BillTo, PriceApproval, ReservationConfig, ReservationQuote } from '@/lib/api';
import { PaymentFields, type PaymentMethodOption } from '@/components/payments/payment-fields';
import { billsCompany, effectiveBillTo, type FullDraft } from './full-draft';

/**
 * Yanolja's Billing Summary: the reservation's price, live, beside the form. Sticky, so the total
 * stays in view while the desk scrolls through guests and options. Below the price: who pays
 * (Bill To), tax exemption, and money taken now (Payment Mode).
 */
export function BillingSummary({
  cfg,
  draft,
  quote,
  current,
  loading,
  money,
  onDraft,
  needsReason,
  needApprovals,
  approvedBy,
  onApprove,
  showErrors,
  hasCityLedger,
  userId,
  methods,
  onBillTo,
}: {
  cfg: ReservationConfig;
  draft: FullDraft;
  quote: ReservationQuote | undefined;
  current: boolean;
  loading: boolean;
  money: (v: string | number) => string;
  onDraft: (patch: Partial<FullDraft>) => void;
  needsReason: boolean;
  needApprovals: PriceApproval[];
  approvedBy: string | null;
  onApprove: () => void;
  showErrors: boolean;
  /** City ledger (Pro): billing a travel agent or company, and the City Ledger payment method. */
  hasCityLedger: boolean;
  /** The desk user, to find their own open cash drawer. */
  userId: string | null;
  /** The ways this reservation can be paid now (see `paymentMethodsFor`). */
  methods: PaymentMethodOption[];
  /** The desk picked Bill To (a default must not overwrite it afterwards). */
  onBillTo: (billTo: BillTo) => void;
}) {
  const kind = cfg.kinds.find((k) => k.kind === draft.kind);
  const nights = Math.max(
    1,
    Math.round((Date.parse(draft.stay.checkout) - Date.parse(draft.stay.checkin)) / 86_400_000),
  );
  const pax = draft.lines.reduce(
    (s, l) => ({ adults: s.adults + l.adults, children: s.children + l.children }),
    { adults: 0, children: 0 },
  );
  const t = quote?.totals;
  const roomCharges = t ? Number(t.amount) - Number(t.taxes) : 0;
  const due = t ? Number(t.due) : null;

  const accountOrigin = draft.origin === 'travel_agent' || draft.origin === 'corporate';
  const account = cfg.accounts.find((a) => a.id === draft.ledgerAccountId);
  // What the desk chose, even before an account makes it effective: choosing "Company" is what
  // opens the account picker below, so the choice must show while the account is still missing.
  const billTo = billsCompany(draft.billTo) ? draft.billTo : effectiveBillTo(draft);
  const companyLocked = hasCityLedger
    ? null
    : 'Billing a travel agent or company is part of the Pro plan';
  // The owner's two ways of billing a company (2026-09-26): all of it, or room and taxes to the
  // agent or company with the extras to the guest.
  const billToOptions: Array<{
    value: BillTo;
    label: string;
    hint?: string;
    locked?: string | null;
  }> = [
    { value: 'guest', label: 'Guest' },
    ...(draft.lines.length > 1
      ? [{ value: 'group_owner' as const, label: 'Group owner', hint: 'one payer for every room' }]
      : []),
    { value: 'company', label: 'Company', hint: 'all charges', locked: companyLocked },
    {
      value: 'company_room_tax',
      label: 'Room & taxes to TA, extras to guest',
      hint: 'split bill',
      locked: companyLocked,
    },
  ];
  // Who can be billed: every active travel agent and company, whatever the booking source.
  const payerOptions: ComboboxOption[] = cfg.accounts
    .filter((a) => a.type === 'travel_agent' || a.type === 'company')
    .map((a) => ({
      value: a.id,
      label: a.name,
      hint: a.type === 'travel_agent' ? 'Travel agent' : 'Company',
      keywords: [a.code],
      group: a.type === 'travel_agent' ? 'Travel agents' : 'Companies',
    }));

  const paidNow = draft.payment.methodId ? Number(draft.payment.amount) || 0 : 0;
  const drawer =
    cfg.openDrawers.find((d) => d.openedByUserId && d.openedByUserId === userId) ??
    cfg.openDrawers[0];

  return (
    <aside
      aria-label="Billing summary"
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Billing Summary</h2>
        {kind && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink-2">
            <TagDot color={kind.color} />
            {kind.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 text-center">
        <div>
          <div className="text-[11px] text-ink-3">Check-in</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-ink">
            {formatDate(draft.stay.checkin)}
          </div>
        </div>
        <ArrowRight size={14} className="text-ink-3" aria-hidden />
        <div>
          <div className="text-[11px] text-ink-3">Check-out</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-ink">
            {formatDate(draft.stay.checkout)}
          </div>
        </div>
      </div>
      <p className="-mt-1 px-4 pb-3 text-center text-xs text-ink-3">
        {nights} night{nights === 1 ? '' : 's'} · {draft.lines.length} room
        {draft.lines.length === 1 ? '' : 's'} · {pax.adults} adult{pax.adults === 1 ? '' : 's'}
        {pax.children > 0 && `, ${pax.children} child${pax.children === 1 ? '' : 'ren'}`}
      </p>

      <dl
        className={cn(
          'flex flex-col gap-1.5 bg-surface-2 px-4 py-3 text-sm transition-opacity duration-1',
          !current && quote && 'opacity-60',
        )}
        aria-live="polite"
        aria-busy={!current}
      >
        {loading && !quote ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <Row label="Room charges" value={money(roomCharges)} />
            {(t?.taxLines ?? []).map((line) => (
              <Row
                key={line.key}
                label={`${line.name} ${line.rate}%`}
                value={money(line.amount)}
                muted
              />
            ))}
            {t && t.taxLines.length === 0 && <Row label="Taxes" value={money(t.taxes)} muted />}
            {t && Number(t.discount) > 0 && (
              <Row label="Coupon" value={`−${money(t.discount)}`} muted />
            )}
            {draft.complimentary && <Row label="Complimentary" value="Rooms free" muted />}
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-semibold text-ink">Due amount</dt>
              <dd
                className="font-mono text-lg font-bold tabular-nums text-ink"
                data-testid="ar-total"
              >
                {money(t?.due ?? 0)}
              </dd>
            </div>
            {paidNow > 0 && due !== null && (
              <>
                <Row label="Paid now" value={`−${money(paidNow)}`} muted />
                <Row label="Balance" value={money(Math.max(0, due - paidNow))} />
              </>
            )}
          </>
        )}
      </dl>

      <div className="flex flex-col gap-3 px-4 py-3">
        <Field label="Bill to" htmlFor="ar-bill-to">
          <Select value={billTo} onValueChange={(v) => onBillTo(v as BillTo)}>
            <SelectTrigger id="ar-bill-to" aria-label="Bill to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {billToOptions.map((o) => (
                <SelectItem
                  key={o.value}
                  value={o.value}
                  disabled={Boolean(o.locked)}
                  hint={o.locked ? 'Pro plan' : o.hint}
                >
                  <span className="flex items-center gap-1.5">
                    {o.label}
                    {o.locked && <Lock size={11} aria-label={o.locked} />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {billsCompany(billTo) && (
          <Field
            label={accountOrigin ? 'Bill to account' : 'Travel agent or company'}
            htmlFor="ar-bill-account"
            error={
              showErrors && !account ? 'Choose who pays, or bill the guest instead' : undefined
            }
          >
            <Combobox
              id="ar-bill-account"
              aria-label="Travel agent or company to bill"
              value={draft.ledgerAccountId}
              onChange={(ledgerAccountId) =>
                onDraft({ ledgerAccountId, useContractRates: false, approvals: {} })
              }
              options={payerOptions}
              placeholder="Choose the account…"
              searchPlaceholder="Search accounts…"
              emptyText="None yet. Add them under Cashiering → City ledger."
            />
          </Field>
        )}
        {billTo === 'company_room_tax' && (
          <p className="-mt-1 text-[11px] text-ink-3">
            Room and taxes go on {account?.name ?? 'the agent or company'}&apos;s bill; meals,
            transfers and other extras go on a second bill for the guest.
          </p>
        )}
        {billsCompany(billTo) && (
          <p className="-mt-1 text-[11px] text-ink-3">
            At check-out the {billTo === 'company' ? 'whole' : 'room and tax'} bill moves to the
            account&apos;s city ledger.
          </p>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
          <Checkbox
            checked={draft.taxExempt.on}
            onCheckedChange={(c) =>
              onDraft({ taxExempt: { ...draft.taxExempt, on: c === true }, approvals: {} })
            }
            aria-label="Tax exempt"
          />
          Tax exempt
        </label>
        {draft.taxExempt.on && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <Field
              label="Exemption ID"
              required
              htmlFor="tax-exempt-id"
              error={
                showErrors && !draft.taxExempt.exemptionId.trim()
                  ? 'Enter the exemption certificate or letter number'
                  : undefined
              }
            >
              <Input
                id="tax-exempt-id"
                value={draft.taxExempt.exemptionId}
                placeholder="e.g. Embassy letter no."
                onChange={(e) =>
                  onDraft({ taxExempt: { ...draft.taxExempt, exemptionId: e.target.value } })
                }
              />
            </Field>
            <p className="text-[11px] text-ink-3">
              Removes the taxes marked exemptible in Setup. A service charge stays.
            </p>
          </div>
        )}

        <div className="border-t border-line pt-3">
          <PaymentFields
            methods={methods}
            value={draft.payment}
            onChange={(payment) => onDraft({ payment })}
            currency={cfg.property.currency}
            max={due}
            allowNone
            showErrors={showErrors}
            idPrefix="ar-pay"
            note={(m) =>
              m.category === 'cash' ? (
                drawer ? (
                  <p className="text-[11px] text-ink-3">
                    Cash goes into the {drawer.drawerName} drawer.
                  </p>
                ) : hasCityLedger ? (
                  <InlineAlert tone="warn">
                    No cash drawer is open. Open a shift under Cashiering → Drawers before taking
                    cash.
                  </InlineAlert>
                ) : null
              ) : m.category === 'city_ledger' && account ? (
                <p className="text-[11px] text-ink-3">
                  Charged to {account.name}&apos;s city ledger account.
                </p>
              ) : null
            }
          />
        </div>

        {needsReason && (
          <div className="flex flex-col gap-2 rounded-lg border border-brass bg-brass-soft p-3">
            <Field
              label="Reason for the price"
              required
              htmlFor="ar-price-reason"
              error={
                showErrors && draft.priceReason.trim().length < 3
                  ? 'Say why the price differs from the rate'
                  : undefined
              }
            >
              <Input
                id="ar-price-reason"
                placeholder="e.g. Embassy stay, repeat guest"
                value={draft.priceReason}
                onChange={(e) => onDraft({ priceReason: e.target.value })}
              />
            </Field>
            {needApprovals.length > 0 ? (
              <InlineAlert
                tone="warn"
                title="An owner needs to approve this price"
                action={
                  <Button type="button" size="sm" onClick={onApprove}>
                    <ShieldCheck size={14} /> Owner approval
                  </Button>
                }
              >
                {needApprovals.includes('rate_override') &&
                  `The discount is more than your limit of ${cfg.settings.rateControl.staffMaxDiscountPct}%. `}
                {needApprovals.includes('complimentary') && 'Complimentary rooms need an owner. '}
                {needApprovals.includes('tax_exempt') && 'Tax exemption needs an owner.'}
              </InlineAlert>
            ) : approvedBy ? (
              <InlineAlert tone="success">Approved by {approvedBy}.</InlineAlert>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? 'text-ink-3' : 'text-ink-2'}>{label}</dt>
      <dd className="font-mono tabular-nums text-ink">{value}</dd>
    </div>
  );
}
