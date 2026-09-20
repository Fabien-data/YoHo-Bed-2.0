'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from '@phosphor-icons/react';
import { Button, Skeleton } from '@yohobed/ui';
import { getRegistrationCard, type InclusionRhythm } from '@/lib/api';

const RHYTHM: Record<InclusionRhythm, string> = {
  once: 'once',
  per_night: 'per night',
  per_guest_per_night: 'per guest, per night',
  per_adult_per_night: 'per adult, per night',
  per_child_per_night: 'per child, per night',
};

/**
 * The printable guest registration card — Yanolja's "Print GR".
 *
 * Printing goes through a dedicated stylesheet rather than a PDF pipeline: the card is one page of
 * text, every hotel wants it on their own letterhead paper, and `window.print()` gives them the
 * browser's own margin and paper-size controls for free.
 */
export function RegistrationCardSheet({ bookingId }: { bookingId: string }) {
  const card = useQuery({
    queryKey: ['registration-card', bookingId],
    queryFn: () => getRegistrationCard(bookingId),
  });

  if (card.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  if (!card.data) {
    return <p className="text-sm text-closed-ink">Could not load the card.</p>;
  }

  const c = card.data;
  const pax = c.legs.reduce((n, l) => n + l.adults + l.children, 0);

  return (
    <div>
      <div className="mb-3 flex justify-end print:hidden">
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer size={14} />
          Print
        </Button>
      </div>

      <div id="gr-card" className="space-y-5 text-sm text-ink">
        <header className="border-b border-line pb-3">
          <h2 className="text-lg font-bold">{c.property.name}</h2>
          <p className="text-xs text-ink-3">
            {[c.property.address, c.property.city, c.property.country].filter(Boolean).join(', ') ||
              '—'}
          </p>
          <p className="text-xs text-ink-3">
            {[c.property.phone, c.property.email].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 font-semibold">Guest registration card</p>
        </header>

        <Section title="Reservation">
          <Field label="Reference" value={c.reference} />
          <Field label="Status" value={c.status} />
          <Field
            label="Arrival"
            value={`${c.checkin}${c.property.checkinTime ? ` from ${c.property.checkinTime}` : ''}`}
          />
          <Field
            label="Departure"
            value={`${c.checkout}${c.property.checkoutTime ? ` by ${c.property.checkoutTime}` : ''}`}
          />
          <Field label="Nights" value={String(c.nights)} />
          <Field label="Guests" value={String(pax)} />
        </Section>

        <Section title="Guest">
          <Field label="Name" value={c.guest.name + (c.guest.vip ? ' (VIP)' : '')} />
          <Field label="Nationality" value={c.guest.nationality ?? '—'} />
          <Field
            label="ID"
            value={c.guest.idNumber ? `${c.guest.idType ?? 'ID'} ${c.guest.idNumber}` : '—'}
          />
          <Field label="Date of birth" value={c.guest.dateOfBirth ?? '—'} />
          <Field label="Email" value={c.guest.email ?? '—'} />
          <Field label="Phone" value={c.guest.phone ?? '—'} />
          <Field
            label="Address"
            value={
              [c.guest.address, c.guest.city, c.guest.country].filter(Boolean).join(', ') || '—'
            }
            wide
          />
        </Section>

        <Section title="Rooms">
          <div className="col-span-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="py-1">#</th>
                  <th className="py-1">Room</th>
                  <th className="py-1">Adults</th>
                  <th className="py-1">Children</th>
                </tr>
              </thead>
              <tbody>
                {c.legs.map((l) => (
                  <tr key={l.legIndex} className="border-b border-line last:border-0">
                    <td className="py-1">{l.legIndex + 1}</td>
                    <td className="py-1 font-mono">{l.code ?? 'Unassigned'}</td>
                    <td className="py-1">{l.adults}</td>
                    <td className="py-1">{l.children}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {c.inclusions.length > 0 && (
          <Section title="Included in the stay">
            <div className="col-span-2">
              <ul className="flex flex-col gap-0.5 text-xs">
                {c.inclusions.map((i, n) => (
                  <li key={n}>
                    {i.name}
                    {i.includedInRate
                      ? ' — included in the rate'
                      : i.unitPrice
                        ? ` — ${c.currency} ${Number(i.unitPrice).toFixed(2)} ${RHYTHM[i.rhythm]}`
                        : ''}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {/* "Suppress rate on registration card": the guest signs for the stay, not for the price. */}
        {!c.rateSuppressed && (
          <Section title="Charges">
            <Field label="Amount" value={`${c.currency} ${Number(c.amount).toFixed(2)}`} />
            <Field label="of which tax" value={`${c.currency} ${Number(c.taxes).toFixed(2)}`} />
          </Section>
        )}

        <div className="grid grid-cols-2 gap-8 pt-6">
          <SignatureLine label="Guest signature" />
          <SignatureLine label="Date" />
        </div>
      </div>

      {/* Print only the card, at readable contrast, whatever the on-screen theme is. */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #gr-card,
          #gr-card * {
            visibility: visible;
            color: #000 !important;
            background: transparent !important;
          }
          #gr-card {
            position: absolute;
            inset: 0;
            padding: 24px;
          }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-3">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">{children}</dl>
    </section>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="h-8 border-b border-ink-3" />
      <p className="mt-1 text-xs text-ink-3">{label}</p>
    </div>
  );
}
