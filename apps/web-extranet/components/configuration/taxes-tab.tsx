'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent } from '@phosphor-icons/react';
import { countryName } from '@yohobed/locale';
import { Badge, Button, Card, ConfirmDialog, InlineAlert, Skeleton, toast } from '@yohobed/ui';
import { applyTaxPreset, describeError, getPropertyTaxes, type PropertyTaxes } from '@/lib/api';

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

function slab(r: PropertyTaxes['taxes'][number]['rates'][number], currency: string) {
  if (r.minAmount === null && r.maxAmount === null) return null;
  if (r.minAmount === null) return `up to ${currency} ${r.maxAmount!.toLocaleString()}`;
  if (r.maxAmount === null) return `above ${currency} ${(r.minAmount - 0.01).toLocaleString()}`;
  return `${currency} ${r.minAmount.toLocaleString()}–${r.maxAmount.toLocaleString()}`;
}

/**
 * Setup → Taxes & levies (Development Phase 02, Sprint 7): what the property charges on a room
 * night, and — for Malaysia and India — switching on the country's tax set-up in one step. Sri
 * Lanka's taxes run on the inclusive engine and are shown as they are.
 */
export function TaxesTab({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['config', 'taxes', propertyId] as const;
  const taxes = useQuery({ queryKey: key, queryFn: () => getPropertyTaxes(propertyId) });
  const [confirming, setConfirming] = React.useState(false);

  const apply = useMutation({
    mutationFn: () => applyTaxPreset(propertyId),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      qc.invalidateQueries({ queryKey: ['config'] });
      toast.success(
        r.repriced > 0
          ? `Taxes set up · ${r.repriced} nightly prices from ${r.repricedFrom} re-priced`
          : 'Taxes set up',
      );
      setConfirming(false);
    },
    onError: (e) => toast.error(describeError(e, 'The taxes could not be set up')),
  });

  if (taxes.isLoading) return <Skeleton className="h-64 w-full" />;
  if (taxes.isError || !taxes.data) {
    return <InlineAlert tone="error">{describeError(taxes.error)}</InlineAlert>;
  }
  const t = taxes.data;
  const forward = t.taxMode === 'exclusive_forward';
  const country = countryName(t.countryCode);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-ink-3">
        {forward
          ? `Room rates here are set before tax. Each tax is worked out on top of the rate, night by night, and shown on its own line of the bill and the invoice.`
          : `Room rates here include their taxes. The bill and the invoice show how much of each price is tax.`}
      </p>

      {t.preset.available && !t.preset.applied && (
        <InlineAlert tone={t.preset.enabled ? 'info' : 'warn'}>
          <p className="font-medium text-ink">{country} taxes</p>
          {t.preset.enabled ? (
            <>
              <p className="mt-1">
                Sets up {country}&apos;s taxes
                {t.countryCode === 'MY' ? ', the Tourism Tax and the guest register' : ''} for this
                property, and re-prices every rate from today on so rates are set before tax.
                Bookings already made keep their prices.
              </p>
              {t.preset.currency && t.currency !== t.preset.currency ? (
                <p className="mt-2 text-sm">
                  This property prices in {t.currency}. {country}&apos;s taxes need{' '}
                  {t.preset.currency} — ask YoHo to change the property&apos;s currency first.
                </p>
              ) : (
                canEdit && (
                  <Button size="sm" className="mt-3" onClick={() => setConfirming(true)}>
                    <Percent size={15} /> Set up {country} taxes
                  </Button>
                )
              )}
            </>
          ) : (
            <p className="mt-1">
              {country}&apos;s tax rules are ready but not switched on yet: they are waiting for a
              tax adviser&apos;s sign-off. YoHo will turn them on for you.
            </p>
          )}
        </InlineAlert>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Taxes on a room night</h3>
          <Badge tone="muted" dot={false}>
            {forward ? 'Added to the rate' : 'Included in the rate'}
          </Badge>
        </div>
        {t.taxes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No taxes are set up for this property.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Tax</th>
                <th className="px-4 py-2 font-medium">Rate</th>
                <th className="px-4 py-2 font-medium">Charged on</th>
                <th className="px-4 py-2 font-medium">Tax-exempt guests</th>
              </tr>
            </thead>
            <tbody>
              {t.taxes.map((tax) => (
                <tr key={tax.id} className="border-t border-line align-top">
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{tax.name}</span>
                    {tax.displayGroup === 'gst_split' && (
                      <span className="block text-xs text-ink-3">Printed as CGST + SGST</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-ink">
                    {tax.rates.map((r, i) => (
                      <span key={i} className="block">
                        {pct(r.ratePercent)}
                        {slab(r, t.currency) && (
                          <span className="ml-2 font-sans text-xs text-ink-3">
                            {slab(r, t.currency)} a night
                          </span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-2 text-ink-2">
                    {tax.compound ? 'The rate and the taxes before it' : 'The rate'}
                  </td>
                  <td className="px-4 py-2 text-ink-2">{tax.exemptible ? 'Excused' : 'Charged'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {t.levies.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Levies</h3>
            <p className="text-xs text-ink-3">
              Charged per room per night stayed, on a line of their own — never inside the rate. The
              registration number printed beside it is under Property profile.
            </p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {t.levies.map((l) => (
                <tr key={l.code} className="border-t border-line first:border-t-0">
                  <td className="px-4 py-2 font-medium text-ink">{l.name}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-ink">
                    {l.currency} {Number(l.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-ink-2">
                    {l.appliesTo === 'non_resident' ? 'Foreign guests only' : 'Every guest'}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={l.active ? 'avail' : 'muted'}>
                      {l.active ? 'Charged' : 'Off'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Set up ${country} taxes?`}
        description={`Room rates become pre-tax and are re-priced from today on. Bookings already made keep their prices. You can review every rate afterwards.`}
        confirmLabel="Set up taxes"
        onConfirm={() => apply.mutate()}
      />
    </div>
  );
}
