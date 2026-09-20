'use client';

import { useCallback, useEffect, useState } from 'react';
import { CaretLeft, CaretRight, Check, Warning } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@yohobed/ui';
import {
  listProperties,
  getRevenue,
  getPayoutStatement,
  type Property,
  type Revenue,
  type PayoutStatement,
} from '@/lib/api';
import { todayISO, firstOfMonth, monthDays, addMonths, monthYear } from '@/lib/format';
import { useMoney } from '@/components/currency';
import { RecentInvoices } from '@/components/invoices/recent-invoices';

export default function FinancePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [month, setMonth] = useState(firstOfMonth(todayISO()));
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [payout, setPayout] = useState<PayoutStatement | null>(null);
  // A failed load must say so. Swallowing it rendered "Rs 0.00" for the month — a wrong number
  // indistinguishable from a genuinely empty month, on the one screen where that matters most.
  const [loadError, setLoadError] = useState<string | null>(null);
  const { money } = useMoney();

  const load = useCallback(async (pid: string, first: string) => {
    const days = monthDays(first);
    const from = days[0]!;
    const to = days[days.length - 1]!;
    try {
      const [rev, pay] = await Promise.all([
        getRevenue(from, to),
        pid ? getPayoutStatement(pid, from, to) : Promise.resolve(null),
      ]);
      setRevenue(rev);
      setPayout(pay);
      setLoadError(null);
    } catch (e) {
      setRevenue(null);
      setPayout(null);
      setLoadError(e instanceof Error ? e.message : 'The figures could not be loaded');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const props = await listProperties();
      setProperties(props);
      const pid = props[0]?.id ?? '';
      setPropertyId(pid);
      await load(pid, month);
    })().catch((e) =>
      setLoadError(e instanceof Error ? e.message : 'The figures could not be loaded'),
    );
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
      <PageHeader
        eyebrow="Cashiering"
        title="Finance"
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => void shiftMonth(-1)}
              >
                <CaretLeft size={14} />
              </Button>
              <span className="min-w-[130px] text-center font-mono text-sm font-semibold text-ink-2">
                {monthYear(month)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next month"
                onClick={() => void shiftMonth(1)}
              >
                <CaretRight size={14} />
              </Button>
              <Input
                type="month"
                className="w-40"
                value={month.slice(0, 7)}
                onChange={(e) => void jumpMonth(e.target.value)}
              />
            </div>
            <Select value={propertyId} onValueChange={(v) => void selectProperty(v)}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {loadError && (
        <div className="mt-5 rounded-lg bg-closed-soft px-4 py-3 text-sm font-medium text-closed-ink">
          These figures could not be loaded ({loadError}). The numbers below are NOT this
          month&rsquo;s revenue —{' '}
          <button type="button" className="underline" onClick={() => void load(propertyId, month)}>
            retry
          </button>
          .
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
            Revenue · approved · {monthYear(month)} (all properties)
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink">
            {loadError
              ? '—'
              : money(revenue ? revenue.approvedGross : 0, revenue?.currency, revenue?.approximate)}
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
                <Badge
                  key={st}
                  tone={st === 'Approved' ? 'avail' : st === 'Pending' ? 'low' : 'muted'}
                >
                  {st} · {v.count}
                </Badge>
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
              <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink">
                {money(payout.netPayable, payout.currency)}{' '}
                <span className="text-sm font-semibold text-ink-3">net payable</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-sm tabular-nums">
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
                className={`mt-3 flex items-start gap-1.5 text-xs font-medium ${
                  reconciles ? 'text-avail-ink' : 'text-closed-ink'
                }`}
              >
                {reconciles ? (
                  <Check size={12} weight="bold" className="mt-0.5 shrink-0" />
                ) : (
                  <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
                )}
                <span>
                  base + yoho + ota + taxes ={' '}
                  {money(
                    payout.propertyBase +
                      payout.yohoCommission +
                      payout.otaCommission +
                      payout.taxes,
                    payout.currency,
                  )}{' '}
                  {reconciles ? 'reconciles to gross' : 'does not reconcile'}
                </span>
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

      <RecentInvoices propertyId={propertyId} />
    </div>
  );
}
