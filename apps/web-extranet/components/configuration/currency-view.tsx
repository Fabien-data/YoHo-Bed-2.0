'use client';

import { useQuery } from '@tanstack/react-query';
import { LockSimple } from '@phosphor-icons/react';
import {
  CURRENCY_META,
  SUPPORTED_CURRENCIES,
  convert,
  isCurrencyCode,
  type CurrencyCode,
  type RatesToLkr,
} from '@yohobed/domain';
import { Badge, Card, InlineAlert, SegmentedControl, Skeleton } from '@yohobed/ui';
import { describeError, getFxRates } from '@/lib/api';
import { useDisplayCurrency } from '@/components/currency';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    : '—';

/** "302.50", or more places for a small rate like INR→USD. */
const rateText = (n: number) =>
  n >= 1
    ? n.toLocaleString('en', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : n.toLocaleString('en', { maximumSignificantDigits: 4 });

/**
 * Configuration → Currency (Yanolja's Currency): the currency the property prices and settles
 * in, the currency each person views amounts in, and the exchange rates behind that view.
 */
export function CurrencyView({ base, propertyName }: { base: string; propertyName: string }) {
  const { display, setDisplay } = useDisplayCurrency();
  const fx = useQuery({ queryKey: ['fx', 'rates'], queryFn: getFxRates });
  const baseCode: CurrencyCode = isCurrencyCode(base) ? base : 'LKR';

  const pivot: RatesToLkr | null = fx.data
    ? (Object.fromEntries([
        ['LKR', 1],
        ...fx.data.rates.filter((r) => r.rate != null).map((r) => [r.base, r.rate as number]),
      ]) as RatesToLkr)
    : null;
  /** 1 `code` in the property's base currency, through the rupee pivot. */
  const inBase = (code: CurrencyCode): number | null => {
    if (!pivot) return null;
    try {
      return convert(1, code, baseCode, pivot);
    } catch {
      return null;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-start gap-4 p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft font-mono text-lg font-semibold text-brand-ink">
          {CURRENCY_META[baseCode].symbol}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Base currency
          </p>
          <p className="mt-0.5 text-lg font-semibold text-ink">
            {CURRENCY_META[baseCode].name}{' '}
            <span className="font-mono text-ink-2">({baseCode})</span>
          </p>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            {propertyName} prices its rooms, takes payments and issues invoices in {baseCode}. Every
            amount is stored in it, so reports never mix currencies.
          </p>
        </div>
        <Badge tone="muted">
          <LockSimple size={12} aria-hidden /> Set by YoHoBed
        </Badge>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink">View amounts in</h3>
        <p className="mb-3 mt-1 max-w-2xl text-sm text-ink-3">
          Your own choice, on this device — the same as the currency picker in the sidebar. Amounts
          in another currency are converted at the latest rate and marked ≈.
        </p>
        <SegmentedControl
          aria-label="View amounts in"
          value={display}
          onChange={setDisplay}
          options={SUPPORTED_CURRENCIES.map((c) => ({
            value: c,
            label: `${CURRENCY_META[c].symbol} ${c}`,
          }))}
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Exchange rates</h3>
          <p className="text-xs text-ink-3">
            Updated automatically every day. If a rate looks wrong, YoHoBed support can correct it —
            every correction is recorded.
          </p>
        </div>
        {fx.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : fx.isError || !fx.data ? (
          <div className="p-4">
            <InlineAlert tone="error">{describeError(fx.error)}</InlineAlert>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-medium">Currency</th>
                  <th className="px-4 py-2 text-right font-medium">1 unit in {baseCode}</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {SUPPORTED_CURRENCIES.filter((c) => c !== baseCode).map((c) => {
                  const row = fx.data.rates.find((r) => r.base === c);
                  const v = inBase(c);
                  return (
                    <tr key={c} className="border-t border-line">
                      <td className="px-4 py-2">
                        <span className="font-medium text-ink">{CURRENCY_META[c].name}</span>{' '}
                        <span className="font-mono text-xs text-ink-3">{c}</span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-ink">
                        {v == null ? (
                          <span className="font-sans text-xs text-ink-3">No rate yet</span>
                        ) : (
                          `${CURRENCY_META[baseCode].symbol} ${rateText(v)}`
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink-2">
                        {c === 'LKR' ? (
                          'Pivot'
                        ) : row?.source === 'manual' ? (
                          <Badge tone="info">Corrected by YoHoBed</Badge>
                        ) : row?.source ? (
                          'Daily market rate'
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums text-ink-3">
                        {c === 'LKR' ? '—' : when(row?.fetchedAt ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
