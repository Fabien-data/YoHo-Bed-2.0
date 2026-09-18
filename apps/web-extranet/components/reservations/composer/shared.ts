'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@yohobed/locale';
import { ApiError, quoteReservation, type ReservationStayInput } from '@/lib/api';

/**
 * What Quick Reservation and the full Add Reservation page share (Development Phase 02): the live
 * quote, and how an API refusal is turned into something the desk can act on.
 */

export const CATEGORY_LABEL: Record<string, string> = {
  direct: 'Direct',
  ota: 'OTA',
  travel_agent: 'Travel agent',
  corporate: 'Corporate',
};

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The browser's local date and time `hours` from now, on a 5-minute step: a hold's default. */
export function localNowPlus(hours: number) {
  const d = new Date(Date.now() + hours * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes() - (d.getMinutes() % 5))}`,
  };
}

/** A fresh idempotency key: one per attempt at a form, never per request. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface ServerError {
  message: string;
  /** Per-line messages, by line index. */
  lines?: Record<number, string>;
  /** Existing guests who own the email or mobile typed, and which room's guest it was. */
  guests?: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
  guestLine?: number;
}

/** Turn an API refusal into something the desk can act on, next to what caused it. */
export function explain(e: unknown): ServerError {
  if (!(e instanceof ApiError)) return { message: 'Something went wrong. Try again.' };
  const d = (e.data ?? {}) as Record<string, unknown>;
  const reason = d.reason as string | undefined;
  const message = (d.message as string | undefined) ?? e.message;
  if (reason === 'insufficient_availability' && Array.isArray(d.lines)) {
    const lines = Object.fromEntries(
      (d.lines as number[]).map((i) => [i, `Not enough free on ${formatDate(d.date as string)}`]),
    );
    return { message, lines };
  }
  if (reason === 'room_taken' || reason === 'room_blocked') {
    return { message, lines: typeof d.line === 'number' ? { [d.line]: message } : undefined };
  }
  if (reason === 'guest_exists') {
    return {
      message: 'Choose the existing guest, or save this one as new.',
      guests: d.candidates as ServerError['guests'],
      guestLine: typeof d.line === 'number' ? d.line : undefined,
    };
  }
  if (reason === 'idempotency_key_reused') {
    return {
      message:
        'This reservation may already have been saved on an earlier attempt. Check the Reservations list before trying again.',
    };
  }
  return { message };
}

/**
 * The live price for a form: debounced, and honest about whether the number on screen is for
 * exactly what the form now says.
 *
 * The reason and approvals do not change the price, so they are left out of the quote's key and
 * typing a reason does not re-quote. `current` is false while a newer quote is loading (TanStack
 * keeps the old one on screen as placeholder data); only a current quote may be booked against,
 * or the "expected total" sent would be stale and the server would rightly refuse it.
 */
export function useLiveQuote(stay: ReservationStayInput | null, enabled: boolean) {
  const body = stay ? { ...stay, priceReason: undefined, approvals: undefined } : null;
  const wanted = body ? JSON.stringify(body) : null;
  const bodyKey = useDebounced(wanted, 300);
  const quote = useQuery({
    queryKey: ['reservation-quote', bodyKey],
    queryFn: () => quoteReservation(JSON.parse(bodyKey!)),
    enabled: enabled && bodyKey !== null,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const current =
    Boolean(quote.data) && !quote.isPlaceholderData && !quote.isFetching && bodyKey === wanted;
  return { quote, current };
}
