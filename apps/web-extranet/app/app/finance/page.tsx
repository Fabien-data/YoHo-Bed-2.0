'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listProperties,
  getRevenue,
  getPayoutStatement,
  type Property,
  type Revenue,
  type PayoutStatement,
} from '@/lib/api';
import { Button, Card, Pill } from '@/components/ui';
import { todayISO, firstOfMonth, monthDays, addMonths, monthYear } from '@/lib/format';
import { useMoney } from '@/components/currency';

const selectClass =
  'rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

export default function FinancePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [month, setMonth] = useState(firstOfMonth(todayISO()));
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [payout, setPayout] = useState<PayoutStatement | null>(null);
  const { money } = useMoney();

  const load = useCallback(async (pid: string, first: string) => {
    const days = monthDays(first);
    const from = days[0]!;
    const to = days[days.length - 1]!;
    const [rev, pay] = await Promise.all([
      getRevenue(from, to).catch(() => null),
      pid ? getPayoutStatement(pid, from, to).catch(() => null) : Promise.resolve(null),
    ]);
    setRevenue(rev);
    setPayout(pay);
  }, []);

  useEffect(() => {
    (async () => {
      const props = await listProperties();
      setProperties(props);
      const pid = props[0]?.id ?? '';
      setPropertyId(pid);
      await load(pid, month);
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function selectProperty(pid: string) {
    setPropertyId(pid);
    await load(pid, month);
  }
  async function shiftMonth(n: number) {
    const next = addMonths(month, n);
    setMonth(next);
    await load(propertyId, next);
  }
  async function jumpMonth(ym: string) {
    if (!ym) return;
    const next = `${ym}-01`;
    setMonth(next);
    await load(propertyId, next);
  }

  const reconciles =
    payout &&
    Math.abs(
      payout.propertyBase +
        payout.yohoCommission +
        payout.otaCommission +
        payout.taxes -
        payout.grossSelling,
    ) < 0.02;

  return (
    <div>
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">Money</div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Finance</h1>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" onClick={() => shiftMonth(-1)} className="!px-3 !py-1.5">
            ◀
          </Button>
          <span className="min-w-[130px] text-center font-mono text-sm font-semibold text-ink-2">
            {monthYear(month)}
          </span>
          <Button variant="secondary" onClick={() => shiftMonth(1)} className="!px-3 !py-1.5">
            ▶
          </Button>
          <input
            type="month"
            className={selectClass}
            value={month.slice(0, 7)}
            onChange={(e) => jumpMonth(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        <select
          className={selectClass}
          value={propertyId}
          onChange={(e) => selectProperty(e.target.value)}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
            Revenue · approved · {monthYear(month)} (all properties)
          </div>
          <div className="mt-1 text-3xl font-extrabold text-ink">
            {money(revenue ? revenue.approvedGross : 0, revenue?.currency, revenue?.approximate)}
          </div>
          {revenue?.approximate && (
            <p className="mt-1 text-xs text-ink-3">
              Your properties price in different currencies, so this total is consolidated to{' '}
              {revenue.currency} at each booking&apos;s recorded rate — approximate. Per-property
              settlement below stays exact.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {revenue &&
              Object.entries(revenue.byStatus).map(([st, v]) => (
                <Pill
                  key={st}
                  tone={st === 'Approved' ? 'avail' : st === 'Pending' ? 'low' : 'muted'}
                >
                  {st} · {v.count}
                </Pill>
              ))}
          </div>
          <p className="mt-4 text-xs text-ink-3">
            {revenue ? revenue.totalBookings : 0} bookings checking in during {monthYear(month)}.
          </p>
        </Card>

        <Card className="p-5">
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
            Payout statement · {properties.find((p) => p.id === propertyId)?.name ?? '—'}
          </div>
          {payout && payout.bookingCount > 0 ? (
            <>
              <div className="mt-1 text-3xl font-extrabold text-ink">
                {money(payout.netPayable, payout.currency)}{' '}
                <span className="text-sm font-semibold text-ink-3">net payable</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-sm">
                <span className="text-ink-3">Gross selling</span>
                <span className="text-right font-semibold">
                  {money(payout.grossSelling, payout.currency)}
                </span>
                <span className="text-ink-3">Property base</span>
                <span className="text-right">{money(payout.propertyBase, payout.currency)}</span>
                <span className="text-ink-3">Yoho commission</span>
                <span className="text-right">{money(payout.yohoCommission, payout.currency)}</span>
                <span className="text-ink-3">OTA commission</span>
                <span className="text-right">{money(payout.otaCommission, payout.currency)}</span>
                <span className="text-ink-3">Taxes</span>
                <span className="text-right">{money(payout.taxes, payout.currency)}</span>
              </div>
              <div
                className="mt-3 text-xs font-medium"
                style={{ color: reconciles ? 'var(--avail-ink)' : 'var(--closed-ink)' }}
              >
                {reconciles ? '✓' : '⚠'} base + yoho + ota + taxes ={' '}
                {money(
                  payout.propertyBase + payout.yohoCommission + payout.otaCommission + payout.taxes,
                  payout.currency,
                )}{' '}
                {reconciles ? 'reconciles to gross' : 'does not reconcile'}
              </div>
              <p className="mt-2 text-xs text-ink-3">
                Across {payout.bookingCount} approved bookings.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-3">
              No approved bookings for this property in {monthYear(month)}.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
