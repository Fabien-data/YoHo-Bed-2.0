'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarBlank, DoorOpen, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Input, Kbd, Popover, PopoverAnchor, PopoverContent, cn } from '@yohobed/ui';
import { searchEverything, type SearchReservation, type StayBar, type StayUnit } from '@/lib/api';
import { searchWindow, type LocalHit } from './model/search';
import { stayRange } from './model/dates';
import { STATE_ICON } from './icons';
import { stateOf } from './model/status';

type Hit = LocalHit | { kind: 'remote'; key: string; reservation: SearchReservation };

/**
 * Find a guest, reference or room without leaving the calendar. Stays on screen are found as you
 * type; anything else in the hotel's history comes from the server, and choosing it moves the
 * window to the stay, scrolls to it and flashes it. While a search is typed, the bars that do
 * not match dim instead of disappearing, so the house around them stays readable.
 */
export function StaySearch({
  propertyId,
  units,
  lanes,
  value,
  onChange,
  onPickStay,
  onPickRoom,
  onPickRemote,
  inputRef,
}: {
  propertyId?: string;
  units: StayUnit[];
  lanes: StayBar[];
  value: string;
  onChange: (v: string) => void;
  onPickStay: (bar: StayBar) => void;
  onPickRoom: (unit: StayUnit) => void;
  onPickRemote: (reservation: SearchReservation) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 220);
    return () => window.clearTimeout(t);
  }, [value]);

  const local = React.useMemo(() => searchWindow(units, lanes, value, 8), [units, lanes, value]);
  const remote = useQuery({
    queryKey: ['stay-search', propertyId, debounced],
    queryFn: () => searchEverything(propertyId!, debounced),
    enabled: !!propertyId && debounced.length >= 2,
    staleTime: 30_000,
  });
  const onScreen = new Set(
    local.flatMap((h) => (h.kind === 'stay' && h.bar.bookingId ? [h.bar.bookingId] : [])),
  );
  const elsewhere: Hit[] = (remote.data?.reservations ?? [])
    .filter((r) => !onScreen.has(r.id))
    .slice(0, 6)
    .map((reservation) => ({ kind: 'remote', key: `r:${reservation.id}`, reservation }));
  const hits: Hit[] = [...local, ...elsewhere];
  React.useEffect(() => setActive(0), [value]);

  const pick = (hit: Hit) => {
    setOpen(false);
    if (hit.kind === 'stay') onPickStay(hit.bar);
    else if (hit.kind === 'room') onPickRoom(hit.unit);
    else onPickRemote(hit.reservation);
  };
  const showing = open && value.trim().length >= 2;

  return (
    <Popover open={showing} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded={showing}
            aria-controls="stay-search-results"
            aria-label="Search this calendar"
            placeholder="Guest, reference or room"
            className="h-9 pl-8 pr-14"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && hits[active]) {
                e.preventDefault();
                pick(hits[active]!);
              } else if (e.key === 'Escape') {
                if (value) {
                  e.stopPropagation();
                  onChange('');
                }
                setOpen(false);
              }
            }}
          />
          {value ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          ) : (
            <Kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        id="stay-search-results"
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <ul role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto">
          {hits.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-ink-3">
              {remote.isFetching
                ? 'Searching the whole hotel…'
                : 'No stay or room matches. Try the reference or a phone number.'}
            </li>
          )}
          {hits.map((hit, i) => {
            const selected = i === active;
            const common = {
              role: 'option' as const,
              'aria-selected': selected,
              onMouseEnter: () => setActive(i),
              onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
              onClick: () => pick(hit),
              className: cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                selected ? 'bg-brand-soft text-ink' : 'text-ink-2',
              ),
            };
            if (hit.kind === 'room')
              return (
                <li key={hit.key} {...common}>
                  <DoorOpen size={15} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="font-mono font-semibold text-ink">{hit.unit.code}</span>
                  <span className="truncate">{hit.unit.displayName ?? 'Room details'}</span>
                </li>
              );
            if (hit.kind === 'stay') {
              const Icon = STATE_ICON[stateOf(hit.bar)];
              return (
                <li key={hit.key} {...common}>
                  <Icon size={15} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {hit.bar.guestName}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {hit.unit ? `${hit.unit.code} · ` : ''}
                    {stayRange(hit.bar.from, hit.bar.to)}
                  </span>
                </li>
              );
            }
            const r = hit.reservation;
            return (
              <li key={hit.key} {...common}>
                <CalendarBlank size={15} className="shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.guestName}</span>
                <span className="shrink-0 text-xs text-ink-3">
                  {r.reference} · {stayRange(r.checkin, r.checkout)}
                </span>
              </li>
            );
          })}
        </ul>
        {elsewhere.length > 0 && (
          <p className="border-t border-line px-2.5 pt-1.5 text-[11px] text-ink-3">
            Stays outside these dates open the calendar at their arrival.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
