'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Switch } from '@yohobed/ui';
import { updateCustomer, type GuestProfile } from '@/lib/api';

/**
 * Edit the guest details a registration card and a police/immigration report need.
 *
 * Every field is optional. An OTA booking arrives with a name and little else, and the desk fills
 * the rest in at check-in — demanding more up front would block the very check-in this supports.
 */
export function GuestProfileForm({
  guest,
  onSaved,
}: {
  guest: Partial<GuestProfile> & { id: string; name: string };
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    nationality: guest.nationality ?? '',
    idType: guest.idType ?? '',
    idNumber: guest.idNumber ?? '',
    dateOfBirth: guest.dateOfBirth ?? '',
    address: guest.address ?? '',
    city: guest.city ?? '',
    country: guest.country ?? '',
    vip: guest.vip ?? false,
  });

  const save = useMutation({
    mutationFn: () =>
      updateCustomer(guest.id, {
        // Empty strings mean "cleared", which the API models as null.
        nationality: form.nationality.trim() || null,
        idType: form.idType.trim() || null,
        idNumber: form.idNumber.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        vip: form.vip,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      onSaved?.();
    },
  });

  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nationality">
          <Input
            value={form.nationality}
            onChange={(e) => set('nationality')(e.target.value)}
            placeholder="Sri Lankan"
          />
        </Field>
        <Field label="Date of birth">
          <Input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => set('dateOfBirth')(e.target.value)}
          />
        </Field>
        <Field label="ID type" hint="Passport, NIC, driving licence…">
          <Input value={form.idType} onChange={(e) => set('idType')(e.target.value)} />
        </Field>
        <Field label="ID number">
          <Input value={form.idNumber} onChange={(e) => set('idNumber')(e.target.value)} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={form.address} onChange={(e) => set('address')(e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => set('city')(e.target.value)} />
        </Field>
        <Field label="Country">
          <Input value={form.country} onChange={(e) => set('country')(e.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-3">
        <Switch checked={form.vip} onCheckedChange={(v) => set('vip')(v)} />
        <span className="text-sm font-medium text-ink-2">
          VIP — flags this guest on every screen
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save profile'}
        </Button>
        {save.isSuccess && <span className="text-sm text-[var(--avail-ink)]">Saved.</span>}
        {save.isError && (
          <span className="text-sm text-[var(--closed-ink)]">{(save.error as Error).message}</span>
        )}
      </div>
    </form>
  );
}
