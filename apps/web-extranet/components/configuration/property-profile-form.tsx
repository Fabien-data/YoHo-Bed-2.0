'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { countryList, presetFor, subdivisionsOf } from '@yohobed/locale';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import {
  updatePropertyProfile,
  type Property,
  type PropertyProfilePatch,
  type PropertyTaxIds,
} from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { NONE, errorMessage } from './shared';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The registration numbers a hotel in each market prints on its documents. */
const TAX_FIELDS: Record<
  string,
  Array<{ key: keyof PropertyTaxIds; label: string; hint?: string }>
> = {
  LK: [
    { key: 'tin', label: 'TIN (VAT registration)', hint: '9 digits, printed on tax invoices' },
    { key: 'ssclRegNo', label: 'SSCL registration' },
    { key: 'sltdaRegNo', label: 'SLTDA registration' },
  ],
  MY: [
    { key: 'sstNo', label: 'SST registration no.' },
    { key: 'ttxNo', label: 'Tourism tax no.', hint: 'Printed beside the tourism tax line' },
    { key: 'brn', label: 'Business registration no. (BRN)' },
  ],
  IN: [{ key: 'gstin', label: 'GSTIN', hint: '15 characters' }],
};

interface Draft {
  name: string;
  legalName: string;
  code: string;
  countryCode: string;
  stateCode: string;
  state: string;
  city: string;
  address: string;
  zip: string;
  phone: string;
  email: string;
  timezone: string;
  checkinTime: string;
  checkoutTime: string;
  taxIds: Record<string, string>;
  branchCode: string;
  fyStartMonth: string;
  invoicePrefix: string;
}

function toDraft(p: Property): Draft {
  return {
    name: p.name,
    legalName: p.legalName ?? '',
    code: p.code ?? '',
    countryCode: p.countryCode ?? 'LK',
    stateCode: p.stateCode ?? NONE,
    state: p.state ?? '',
    city: p.city ?? '',
    address: p.address ?? '',
    zip: p.zip ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    timezone: p.timezone ?? 'Asia/Colombo',
    checkinTime: (p.checkinTime ?? '14:00').slice(0, 5),
    checkoutTime: (p.checkoutTime ?? '11:00').slice(0, 5),
    taxIds: { ...(p.taxIds ?? {}) } as Record<string, string>,
    branchCode: p.branchCode ?? '',
    fyStartMonth: String(p.fyStartMonth ?? 4),
    invoicePrefix: p.invoicePrefix ?? '',
  };
}

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  const preferred = ['Asia/Colombo', 'Asia/Kuala_Lumpur', 'Asia/Kolkata'];
  const rest = all.filter((z) => !preferred.includes(z));
  const list = [...preferred, ...rest];
  return list.includes(current) ? list : [current, ...list];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5 first:pt-0 last:border-0 last:pb-0">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * The property's identity: what prints on registration cards and invoices, the operating times
 * that seed every reservation, and the country that selects the regional behaviour.
 */
export function PropertyProfileForm({
  property,
  canEdit,
}: {
  property: Property;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(property));
  React.useEffect(() => setDraft(toDraft(property)), [property]);

  const countries = React.useMemo(() => countryList(), []);
  const zones = React.useMemo(() => timezones(draft.timezone), [draft.timezone]);
  const states = subdivisionsOf(draft.countryCode);
  const taxFields = TAX_FIELDS[draft.countryCode] ?? TAX_FIELDS.LK!;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const original = toDraft(property);
      const taxIds: Record<string, string> = {};
      for (const f of Object.values(TAX_FIELDS).flat()) {
        const now = draft.taxIds[f.key]?.trim() ?? '';
        if (now !== (original.taxIds[f.key] ?? '')) taxIds[f.key] = now;
      }
      const body: PropertyProfilePatch = {
        name: draft.name.trim(),
        legalName: draft.legalName.trim() || null,
        code: draft.code.trim() || null,
        ...(draft.countryCode !== original.countryCode && { countryCode: draft.countryCode }),
        stateCode: states.length > 0 && draft.stateCode !== NONE ? draft.stateCode : null,
        state: states.length > 0 ? null : draft.state.trim() || null,
        city: draft.city.trim() || null,
        address: draft.address.trim() || null,
        zip: draft.zip.trim() || null,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        timezone: draft.timezone,
        checkinTime: draft.checkinTime,
        checkoutTime: draft.checkoutTime,
        ...(Object.keys(taxIds).length > 0 && { taxIds }),
        branchCode: draft.branchCode.trim() || null,
        fyStartMonth: Number(draft.fyStartMonth),
        invoicePrefix: draft.invoicePrefix.trim() || null,
      };
      return updatePropertyProfile(property.id, body);
    },
    onSuccess: () => {
      toast.success('Property profile saved');
      qc.invalidateQueries({ queryKey: queryKeys.properties });
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const changeCountry = (code: string) => {
    const preset = presetFor(code);
    setDraft((d) => ({
      ...d,
      countryCode: code,
      stateCode: NONE,
      // Follow the market's usual timezone and invoice year when the country changes.
      ...(code === preset.country && {
        timezone: preset.timezone,
        fyStartMonth: String(preset.fyStartMonth),
      }),
    }));
  };

  return (
    <Card className="p-5">
      <fieldset disabled={!canEdit}>
        <Section title="Identity">
          <Field label="Property name" required>
            <Input
              value={draft.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Registered business name" hint="Printed on tax invoices">
            <Input
              value={draft.legalName}
              maxLength={200}
              onChange={(e) => set('legalName', e.target.value)}
            />
          </Field>
          <Field label="Property code">
            <Input
              value={draft.code}
              maxLength={32}
              className="font-mono"
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Location & contact">
          <Field
            label="Country"
            hint="Sets titles, ID types, taxes and invoice rules. Locked once the property has bookings."
          >
            <Select value={draft.countryCode} onValueChange={changeCountry}>
              <SelectTrigger aria-label="Country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {states.length > 0 ? (
            <Field label={draft.countryCode === 'LK' ? 'Province' : 'State'}>
              <Select value={draft.stateCode} onValueChange={(v) => set('stateCode', v)}>
                <SelectTrigger aria-label={draft.countryCode === 'LK' ? 'Province' : 'State'}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {states.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="State / region">
              <Input
                value={draft.state}
                maxLength={80}
                onChange={(e) => set('state', e.target.value)}
              />
            </Field>
          )}
          <Field label="City">
            <Input
              value={draft.city}
              maxLength={80}
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input
              value={draft.address}
              maxLength={300}
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
          <Field label="Postal code">
            <Input value={draft.zip} maxLength={16} onChange={(e) => set('zip', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={draft.phone}
              maxLength={40}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Timezone" hint="The hotel's day — business dates and today follow it.">
            <Select value={draft.timezone} onValueChange={(v) => set('timezone', v)}>
              <SelectTrigger aria-label="Timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Operating times">
          <Field label="Check-in time" hint="Pre-filled on every new reservation">
            <Input
              type="time"
              value={draft.checkinTime}
              onChange={(e) => set('checkinTime', e.target.value)}
            />
          </Field>
          <Field label="Check-out time">
            <Input
              type="time"
              value={draft.checkoutTime}
              onChange={(e) => set('checkoutTime', e.target.value)}
            />
          </Field>
          <Field label="Base currency" hint="Set by YoHoBed when the property is onboarded">
            <Input value={property.currency ?? 'LKR'} disabled className="font-mono" />
          </Field>
        </Section>

        <Section title="Tax & invoicing">
          {taxFields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Input
                value={draft.taxIds[f.key] ?? ''}
                maxLength={30}
                className="font-mono uppercase"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, taxIds: { ...d.taxIds, [f.key]: e.target.value } }))
                }
              />
            </Field>
          ))}
          <Field label="Invoice prefix" hint="Letters, digits, / and -">
            <Input
              value={draft.invoicePrefix}
              maxLength={10}
              className="font-mono uppercase"
              onChange={(e) => set('invoicePrefix', e.target.value)}
            />
          </Field>
          {draft.countryCode === 'LK' && (
            <Field label="Branch code" hint="The branch part of the tax invoice number">
              <Input
                value={draft.branchCode}
                maxLength={15}
                className="font-mono uppercase"
                onChange={(e) => set('branchCode', e.target.value)}
              />
            </Field>
          )}
          <Field label="Financial year starts in">
            <Select value={draft.fyStartMonth} onValueChange={(v) => set('fyStartMonth', v)}>
              <SelectTrigger aria-label="Financial year starts in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      </fieldset>

      {canEdit && (
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={() => setDraft(toDraft(property))}>
            Reset
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft.name.trim()}
            onClick={() => save.mutate()}
          >
            Save profile
          </Button>
        </div>
      )}
    </Card>
  );
}
