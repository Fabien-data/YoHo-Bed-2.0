'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarBlank, MapPin, Phone, WhatsappLogo } from '@phosphor-icons/react';
import { Badge, Skeleton } from '@yohobed/ui';
import { getGuestBookingPage, type GuestBookingPage } from '@/lib/api';
import { longDate } from '@/lib/format';
import { formatTime } from '@yohobed/locale';
import { AuthShell } from '@/components/auth-shell';

/**
 * The guest's own booking page (Development Phase 02, Sprint 6) — opened from the link in the
 * voucher email or a WhatsApp message, with no login. Read-only, and deliberately thin: the stay,
 * the hotel and how to reach it. Nothing here identifies the guest beyond their first name.
 */
export default function GuestBookingPageView() {
  const params = useParams<{ token: string }>();
  const [booking, setBooking] = useState<GuestBookingPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');

  useEffect(() => {
    getGuestBookingPage(params.token)
      .then((b) => {
        setBooking(b);
        setState('ready');
      })
      .catch(() => setState('invalid'));
  }, [params.token]);

  return (
    <AuthShell width="lg">
      {state === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {state === 'invalid' && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            This booking link isn&rsquo;t valid
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            It may have expired, or the hotel may have closed it. Please contact the hotel — they
            can send you a new one.
          </p>
        </>
      )}

      {state === 'ready' && booking && (
        <>
          <p className="text-xs font-medium uppercase tracking-wider text-brass">
            {booking.property.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            Hello {booking.guestFirstName}, your booking is confirmed
          </h1>
          <p className="mt-1 font-mono text-sm text-ink-2">{booking.reference}</p>

          <div className="mt-5 grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface-2 p-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-3">Check-in</div>
              <div className="text-sm font-semibold text-ink">{longDate(booking.checkin)}</div>
              <div className="text-xs text-ink-2">from {formatTime(booking.checkinTime)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-3">Check-out</div>
              <div className="text-sm font-semibold text-ink">{longDate(booking.checkout)}</div>
              <div className="text-xs text-ink-2">by {formatTime(booking.checkoutTime)}</div>
            </div>
            <div className="col-span-2 flex items-center gap-2 border-t border-line pt-3 text-xs text-ink-2">
              <CalendarBlank size={14} aria-hidden />
              {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.rooms.length} room
              {booking.rooms.length === 1 ? '' : 's'}
            </div>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {booking.rooms.map((r, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <span className="font-medium text-ink">{r.roomType}</span>
                {r.mealPlan && (
                  <Badge tone="muted" dot={false}>
                    {r.mealPlan}
                  </Badge>
                )}
                <span className="text-xs text-ink-3">
                  {r.adults} adult{r.adults === 1 ? '' : 's'}
                  {r.children ? `, ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 flex flex-col gap-1 text-sm">
            <Row label="Total" value={amount(booking.total, booking.currency)} />
            <Row label="Paid" value={amount(booking.paid, booking.currency)} muted />
            <Row label="Balance due" value={amount(booking.balance, booking.currency)} strong />
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <h2 className="text-sm font-semibold text-ink">{booking.property.name}</h2>
            {booking.property.address && (
              <p className="mt-0.5 text-sm text-ink-2">{booking.property.address}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {booking.property.mapUrl && (
                <Action
                  href={booking.property.mapUrl}
                  icon={<MapPin size={14} />}
                  label="Directions"
                />
              )}
              {booking.property.phone && (
                <Action
                  href={`tel:${booking.property.phone}`}
                  icon={<Phone size={14} />}
                  label="Call the hotel"
                />
              )}
              {booking.property.whatsappUrl && (
                <Action
                  href={booking.property.whatsappUrl}
                  icon={<WhatsappLogo size={14} />}
                  label="WhatsApp the hotel"
                />
              )}
            </div>
          </div>
        </>
      )}
    </AuthShell>
  );
}

/** `LKR 63,250.00` — grouped, as a guest reads money. */
function amount(value: string, currency: string): string {
  return `${currency} ${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={muted ? 'text-ink-3' : 'text-ink-2'}>{label}</dt>
      <dd className={`font-mono tabular-nums ${strong ? 'font-bold text-ink' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

function Action({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition duration-1 hover:border-ink-3 hover:text-ink"
    >
      {icon}
      {label}
    </a>
  );
}
