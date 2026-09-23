'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  InlineAlert,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import { describeError, getFxRates, overrideFxRate } from '@/lib/api';

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? 'within the hour' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/**
 * Exchange rates, for YoHo staff (Development Phase 02, Sprint 7 — closes deferred audit gap #6).
 * The worker fetches rates every few hours; when the provider has none for a currency (a MYR or
 * INR hotel cannot take a booking without one) or is plainly wrong, staff set it here. Every
 * override is kept in the rate history and the audit log.
 */
export function FxRatesPanel() {
  const qc = useQueryClient();
  const rates = useQuery({ queryKey: ['fx', 'rates'], queryFn: getFxRates });
  const [base, setBase] = React.useState('');
  const [rate, setRate] = React.useState('');
  const [note, setNote] = React.useState('');

  const save = useMutation({
    mutationFn: () => overrideFxRate({ base, rate: Number(rate), note: note.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(`1 ${r.base} = ${r.rate} LKR from now on`);
      setRate('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['fx'] });
    },
  });

  const others = (rates.data?.rates ?? []).filter((r) => r.base !== 'LKR');
  const valid = base && Number(rate) > 0;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-ink">Exchange rates</h2>
      <p className="mt-1 max-w-2xl text-xs text-ink-3">
        Every rate is &ldquo;1 unit = N LKR&rdquo;. A booking snapshots the rate of its currency
        when it is made; a hotel in a currency with no rate cannot take bookings until one is set.
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="divide-y divide-line">
          {others.map((r) => (
            <div key={r.base} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-ink">{r.base}</span>
                {r.source && (
                  <Badge tone={r.source === 'manual' ? 'brass' : 'muted'} dot={false}>
                    {r.source === 'manual' ? 'set by staff' : 'fetched'}
                  </Badge>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-sm tabular-nums text-ink">
                  {r.rate === null ? (
                    <span className="text-closed-ink">no rate</span>
                  ) : (
                    Number(r.rate).toFixed(4)
                  )}
                </div>
                <div className="text-[11px] text-ink-3">{ago(r.fetchedAt)}</div>
              </div>
            </div>
          ))}
        </Card>
        <Card className="p-4">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <Field label="Currency">
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger aria-label="Currency to set">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {others.map((r) => (
                    <SelectItem key={r.base} value={r.base}>
                      {r.base}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="1 unit in LKR">
              <Input
                inputMode="decimal"
                className="font-mono"
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </Field>
            <Field label="Why" hint="Kept in the audit log">
              <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {save.isError && <InlineAlert tone="error">{describeError(save.error)}</InlineAlert>}
            <Button type="submit" loading={save.isPending} disabled={!valid}>
              Set rate
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}
