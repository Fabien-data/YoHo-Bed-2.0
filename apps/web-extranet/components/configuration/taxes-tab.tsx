'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PencilSimple, Percent, Plus, Trash } from '@phosphor-icons/react';
import { countryName, formatDate } from '@yohobed/locale';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DatePicker,
  Field,
  InlineAlert,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  Switch,
  toast,
} from '@yohobed/ui';
import {
  applyTaxPreset,
  createTax,
  describeError,
  getPropertyTaxes,
  removeTax,
  updateTax,
  type PropertyTaxes,
  type TaxInput,
} from '@/lib/api';
import { SettingRow } from './shared';

type Tax = PropertyTaxes['taxes'][number];
type Rate = Tax['rates'][number];

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** Yanolja's order of charging: the service charge first, VAT on everything before it. */
const ORDER: Record<1 | 2 | 3, string> = {
  1: 'First — like a service charge',
  2: 'Second — like a levy',
  3: 'Last — like VAT',
};

function slab(r: Rate, currency: string) {
  if (r.minAmount === null && r.maxAmount === null) return null;
  if (r.minAmount === null) return `up to ${currency} ${r.maxAmount!.toLocaleString()}`;
  if (r.maxAmount === null) return `above ${currency} ${(r.minAmount - 0.01).toLocaleString()}`;
  return `${currency} ${r.minAmount.toLocaleString()}–${r.maxAmount.toLocaleString()}`;
}

const isSlab = (tax: Tax) => tax.rates.some((r) => r.minAmount !== null || r.maxAmount !== null);

/** The rates in force today, and the changes already scheduled after it. */
function ratesAround(tax: Tax, today: string) {
  const now = tax.rates.filter((r) => r.startDate <= today && r.endDate >= today);
  const next = tax.rates.filter((r) => r.startDate > today);
  return { now, next };
}

/**
 * Configuration → Taxes: what the property charges on a room night, tax by tax — added, changed
 * from a date on (every night before it keeps the rate it had), or stopped. For Malaysia and
 * India, the country's tax set-up switches on in one step.
 */
export function TaxesTab({
  propertyId,
  canEdit,
  today,
}: {
  propertyId: string;
  canEdit: boolean;
  today: string;
}) {
  const qc = useQueryClient();
  const key = ['config', 'taxes', propertyId] as const;
  const taxes = useQuery({ queryKey: key, queryFn: () => getPropertyTaxes(propertyId) });
  const [confirming, setConfirming] = React.useState(false);
  const [editing, setEditing] = React.useState<Tax | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<Tax | null>(null);

  const changed = (
    r: PropertyTaxes & { repriced: number; repricedFrom: string | null },
    what: string,
  ) => {
    qc.setQueryData(key, r);
    qc.invalidateQueries({ queryKey: ['config'] });
    qc.invalidateQueries({ queryKey: ['room-availability'] });
    toast.success(
      r.repriced > 0 && r.repricedFrom
        ? `${what} · ${r.repriced} nightly prices from ${formatDate(r.repricedFrom)} re-priced`
        : what,
    );
  };
  const apply = useMutation({
    mutationFn: () => applyTaxPreset(propertyId),
    onSuccess: (r) => {
      changed(r, 'Taxes set up');
      setConfirming(false);
    },
    onError: (e) => toast.error(describeError(e, 'The taxes could not be set up')),
  });
  const remove = useMutation({
    mutationFn: (tax: Tax) => removeTax(propertyId, tax.id),
    onSuccess: (r, tax) => changed(r, `${tax.name} is no longer charged`),
    onError: (e) => toast.error(describeError(e, 'The tax could not be removed')),
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
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Taxes on a room night</h3>
          <Badge tone="muted" dot={false}>
            {forward ? 'Added to the rate' : 'Included in the rate'}
          </Badge>
          <div className="flex-1" />
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden /> Add tax
            </Button>
          )}
        </div>
        {t.taxes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No taxes are set up for this property.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-medium">Tax</th>
                  <th className="px-4 py-2 font-medium">Rate</th>
                  <th className="px-4 py-2 font-medium">Charged on</th>
                  <th className="px-4 py-2 font-medium">Tax-exempt guests</th>
                  {canEdit && (
                    <th className="px-4 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {t.taxes.map((tax) => {
                  const { now, next } = ratesAround(tax, today);
                  return (
                    <tr key={tax.id} className="border-t border-line align-top">
                      <td className="px-4 py-2">
                        <span className="font-medium text-ink">{tax.name}</span>
                        {tax.code && (
                          <>
                            {' '}
                            <span className="ml-2 font-mono text-[11px] text-ink-3">
                              {tax.code}
                            </span>
                          </>
                        )}
                        {tax.displayGroup === 'gst_split' && (
                          <span className="block text-xs text-ink-3">Printed as CGST + SGST</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-ink">
                        {now.map((r, i) => (
                          <span key={i} className="block">
                            {pct(r.ratePercent)}
                            {slab(r, t.currency) && (
                              <span className="ml-2 font-sans text-xs text-ink-3">
                                {slab(r, t.currency)} a night
                              </span>
                            )}
                          </span>
                        ))}
                        {!now.length && next.length === 0 && (
                          <span className="font-sans text-xs text-ink-3">Not charged now</span>
                        )}
                        {next
                          .filter((r) => r.minAmount === null && r.maxAmount === null)
                          .map((r, i) => (
                            <span key={`n${i}`} className="block font-sans text-xs text-info-ink">
                              {pct(r.ratePercent)} from {formatDate(r.startDate)}
                            </span>
                          ))}
                      </td>
                      <td className="px-4 py-2 text-ink-2">
                        {tax.compound ? 'The rate and the taxes before it' : 'The rate'}
                      </td>
                      <td className="px-4 py-2 text-ink-2">
                        {tax.exemptible ? 'Excused' : 'Charged'}
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-4 py-1.5 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${tax.name}`}
                            onClick={() => setEditing(tax)}
                          >
                            <PencilSimple size={15} aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Stop charging ${tax.name}`}
                            onClick={() => setRemoving(tax)}
                          >
                            <Trash size={15} aria-hidden />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {t.levies.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Levies</h3>
            <p className="text-xs text-ink-3">
              Charged per room per night stayed, on a line of their own — never inside the rate. The
              registration number printed beside it is under Hotel profile.
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

      {editing && (
        <TaxSheet
          propertyId={propertyId}
          tax={editing === 'new' ? null : editing}
          today={today}
          current={
            editing === 'new' ? null : (ratesAround(editing, today).now[0]?.ratePercent ?? null)
          }
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Set up ${country} taxes?`}
        description={`Room rates become pre-tax and are re-priced from today on. Bookings already made keep their prices. You can review every rate afterwards.`}
        confirmLabel="Set up taxes"
        onConfirm={() => apply.mutate()}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Stop charging ${removing.name}?` : ''}
        description="From today, prices are worked out without it and the rates calendar is re-priced. Stays already booked keep their prices, and invoices already issued do not change."
        confirmLabel="Stop charging"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </div>
  );
}

function TaxSheet({
  propertyId,
  tax,
  today,
  current,
  onClose,
  onSaved,
}: {
  propertyId: string;
  tax: Tax | null;
  today: string;
  current: number | null;
  onClose: () => void;
  onSaved: (
    r: PropertyTaxes & { repriced: number; repricedFrom: string | null },
    what: string,
  ) => void;
}) {
  const slabbed = tax ? isSlab(tax) : false;
  const [name, setName] = React.useState(tax?.name ?? '');
  const [code, setCode] = React.useState(tax?.code ?? '');
  const [rate, setRate] = React.useState(current === null ? '' : String(current));
  const [priority, setPriority] = React.useState<1 | 2 | 3>(
    (tax?.priority as 1 | 2 | 3 | undefined) ?? 3,
  );
  const [exemptible, setExemptible] = React.useState(tax?.exemptible ?? true);
  const [from, setFrom] = React.useState(today);
  const rateNum = Number(rate);
  const rateValid =
    rate.trim() !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100;
  const rateChanged = !tax || (!slabbed && rateValid && rateNum !== current);

  const save = useMutation({
    mutationFn: () => {
      if (!tax)
        return createTax(propertyId, {
          name: name.trim(),
          code: code.trim() || null,
          ratePercent: rateNum,
          priority,
          exemptible,
          from,
        });
      const body: Partial<TaxInput> = {};
      if (name.trim() !== tax.name) body.name = name.trim();
      if ((code.trim() || null) !== tax.code) body.code = code.trim() || null;
      if (priority !== tax.priority) body.priority = priority;
      if (exemptible !== tax.exemptible) body.exemptible = exemptible;
      if (rateChanged) {
        body.ratePercent = rateNum;
        body.from = from;
      }
      return updateTax(propertyId, tax.id, body);
    },
    onSuccess: (r) => {
      onSaved(r, tax ? `${name.trim()} is saved` : `${name.trim()} is added`);
      onClose();
    },
    onError: (e) => toast.error(describeError(e, 'The tax could not be saved')),
  });
  const valid = Boolean(name.trim()) && (slabbed || rateValid);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={tax ? `Edit ${tax.name}` : 'Add a tax'}
        description="Charged on every room night. A new rate starts on the day you choose; the nights before it keep the rate they had."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
              {tax ? 'Save' : 'Add tax'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tax name" required htmlFor="tax-name" className="col-span-2">
              <Input
                id="tax-name"
                value={name}
                maxLength={60}
                placeholder="e.g. Service Charge"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Code" htmlFor="tax-code" hint="On the invoice">
              <Input
                id="tax-code"
                value={code}
                maxLength={10}
                className="font-mono uppercase"
                onChange={(e) =>
                  setCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase())
                }
              />
            </Field>
          </div>
          {slabbed ? (
            <InlineAlert tone="info">
              This tax changes with the price (slabs), so its rates come from the country set-up.
              You can rename it here.
            </InlineAlert>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate (%)" required htmlFor="tax-rate">
                <Input
                  id="tax-rate"
                  inputMode="decimal"
                  className="font-mono tabular-nums"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
                />
              </Field>
              <Field
                label={tax ? 'New rate from' : 'Charged from'}
                htmlFor="tax-from"
                hint={tax && !rateChanged ? 'Change the rate to pick a day' : undefined}
              >
                <DatePicker
                  id="tax-from"
                  value={from}
                  today={today}
                  min={today}
                  disabled={Boolean(tax) && !rateChanged}
                  onChange={setFrom}
                />
              </Field>
            </div>
          )}
          <Field
            label="Order of charging"
            htmlFor="tax-order"
            hint="A later tax can be charged on the earlier ones."
          >
            <Select
              value={String(priority)}
              onValueChange={(v) => setPriority(Number(v) as 1 | 2 | 3)}
            >
              <SelectTrigger id="tax-order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([1, 2, 3] as const).map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {ORDER[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="rounded-lg border border-line px-3">
            <SettingRow
              title="Excuse tax-exempt guests"
              description="Diplomats and other exempt guests do not pay it."
            >
              <Switch
                aria-label="Excuse tax-exempt guests"
                checked={exemptible}
                onCheckedChange={setExemptible}
              />
            </SettingRow>
          </div>
          <p className="text-xs text-ink-3">
            Saving re-prices the rates calendar from that day on. Stays already booked keep the
            prices they were sold at.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
