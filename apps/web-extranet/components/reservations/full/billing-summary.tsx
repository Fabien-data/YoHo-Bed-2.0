'use client';

import * as React from 'react';
import { ArrowRight, ShieldCheck } from '@phosphor-icons/react';
import { Button, Checkbox, Field, InlineAlert, Input, Skeleton, TagDot, cn } from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import type { PriceApproval, ReservationConfig, ReservationQuote } from '@/lib/api';
import type { FullDraft } from './full-draft';

/**
 * Yanolja's Billing Summary: the reservation's price, live, beside the form. Sticky, so the total
 * stays in view while the desk scrolls through guests and options.
 *
 * Bill To and Payment Mode arrive with Sprint 5 (payments at reservation); the money here is what
 * the reservation will cost, not how it is paid.
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
          </>
        )}
      </dl>

      <div className="flex flex-col gap-3 px-4 py-3">
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
