'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, UserCircleCheck, WhatsappLogo, X } from '@phosphor-icons/react';
import {
  Checkbox,
  Field,
  Input,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@yohobed/ui';
import { formatPhone } from '@yohobed/locale';
import { searchGuests, type GuestMatch } from '@/lib/api';
import type { GuestDraft } from './draft';
import { useDebounced } from './shared';

/**
 * Title · Full Name · Mobile · Email — and, while the desk types, the returning guests that match.
 *
 * One full-name field, not first/last: many Sri Lankan, Malaysian and Indian names do not split
 * that way, and a form that forces it gets "A" in the first-name box.
 */
export function GuestFields({
  value,
  onChange,
  titles,
  country,
  conflict,
  idPrefix = 'qr',
  label = 'Guest name',
}: {
  value: GuestDraft;
  onChange: (next: GuestDraft) => void;
  titles: string[];
  /** The property's country — a number typed without a prefix is read in it. */
  country: string;
  /** Guests the server said already own this email or mobile. */
  conflict:
    | GuestMatch[]
    | Array<{ id: string; name: string; email: string | null; phone: string | null }>
    | null;
  /** Keeps field ids unique when several guests are on one page (the Guest List). */
  idPrefix?: string;
  label?: string;
}) {
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const linked = value.customerId !== null;

  // Search on whichever the desk typed that is specific enough: a mobile, an email, or a name.
  const digits = value.phone.number.replace(/\D/g, '');
  const term =
    digits.length >= 6
      ? value.phone.number
      : value.email.trim().length >= 4
        ? value.email.trim()
        : value.name.trim().length >= 3
          ? value.name.trim()
          : '';
  const q = useDebounced(term, 300);
  const matches = useQuery({
    queryKey: ['guest-search', q],
    queryFn: () => searchGuests(q),
    enabled: !linked && q.length > 0,
    staleTime: 30_000,
  });
  const offered = (matches.data ?? []).filter(() => dismissed !== q);

  function link(g: {
    id: string;
    name: string;
    title?: string | null;
    email: string | null;
    phone: string | null;
    mobileE164?: string | null;
    whatsapp?: boolean;
  }) {
    onChange({
      ...value,
      customerId: g.id,
      title: g.title ?? value.title,
      name: g.name,
      email: g.email ?? '',
      phone: { number: g.mobileE164 ? formatPhone(g.mobileE164) : (g.phone ?? ''), country },
      whatsapp: g.whatsapp ?? false,
      createNew: false,
    });
  }

  function unlink() {
    onChange({ ...value, customerId: null });
  }

  const set = (patch: Partial<GuestDraft>) =>
    onChange({ ...value, ...patch, createNew: patch.createNew ?? value.createNew });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.2fr)]">
        <Field label={label} required htmlFor={`${idPrefix}-guest-name`}>
          <div className="flex">
            <Select
              value={value.title || undefined}
              onValueChange={(title) => set({ title })}
              disabled={linked}
            >
              <SelectTrigger aria-label="Title" className="w-24 shrink-0 rounded-r-none">
                <SelectValue placeholder="Title" />
              </SelectTrigger>
              <SelectContent>
                {titles.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id={`${idPrefix}-guest-name`}
              autoComplete="off"
              placeholder="Full name"
              value={value.name}
              readOnly={linked}
              onChange={(e) => set({ name: e.target.value })}
              className="-ml-px rounded-l-none"
            />
          </div>
        </Field>
        <Field label="Mobile" htmlFor={`${idPrefix}-guest-mobile`}>
          <PhoneInput
            id={`${idPrefix}-guest-mobile`}
            value={value.phone}
            disabled={linked}
            onChange={(phone) => set({ phone })}
          />
        </Field>
        <Field label="Email" htmlFor={`${idPrefix}-guest-email`}>
          <Input
            id={`${idPrefix}-guest-email`}
            type="email"
            autoComplete="off"
            placeholder="Email"
            value={value.email}
            readOnly={linked}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {value.phone.number.trim() !== '' && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <Checkbox
              checked={value.whatsapp}
              disabled={linked}
              onCheckedChange={(c) => set({ whatsapp: c === true })}
              aria-label="This mobile is on WhatsApp"
            />
            <WhatsappLogo size={15} className="text-avail-ink" />
            On WhatsApp
          </label>
        )}

        {linked && (
          <span className="flex items-center gap-2 rounded-full bg-avail-soft px-2.5 py-1 text-xs font-semibold text-avail-ink">
            <UserCircleCheck size={14} weight="fill" />
            Returning guest — linked to their profile
            <button
              type="button"
              onClick={unlink}
              className="ml-1 underline decoration-dotted underline-offset-2"
            >
              Change
            </button>
          </span>
        )}
      </div>

      {!linked && offered.length > 0 && !conflict && (
        <div className="rounded-lg border border-line bg-surface-2 p-2" aria-live="polite">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-xs font-semibold text-ink-2">Returning guest?</span>
            <button
              type="button"
              aria-label="Not a returning guest"
              onClick={() => setDismissed(q)}
              className="rounded p-0.5 text-ink-3 hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {offered.slice(0, 4).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => link(g)}
                className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-left text-xs transition duration-1 hover:border-brand"
              >
                {g.vip && <Crown size={12} weight="fill" className="text-brass-ink" />}
                <span className="font-semibold text-ink">
                  {g.title ? `${g.title} ` : ''}
                  {g.name}
                </span>
                <span className="text-ink-3">
                  {g.stays > 0 ? `${g.stays} stay${g.stays === 1 ? '' : 's'}` : 'No stays yet'}
                  {g.mobileE164
                    ? ` · ${formatPhone(g.mobileE164)}`
                    : g.email
                      ? ` · ${g.email}`
                      : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {conflict && conflict.length > 0 && !linked && (
        <div
          className="rounded-lg border border-low bg-low-soft p-3 text-sm text-low-ink"
          role="alert"
        >
          <p className="font-semibold">This email or mobile already belongs to a guest.</p>
          <p className="mt-0.5 text-[13px]">
            Use their profile, or save this as a different guest.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {conflict.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => link(g)}
                className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink transition duration-1 hover:border-brand"
              >
                Use {g.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => set({ createNew: true })}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition duration-1',
                value.createNew ? 'bg-low text-white' : 'text-low-ink underline underline-offset-2',
              )}
            >
              {value.createNew ? 'Will save as a new guest' : 'Save as a new guest'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
