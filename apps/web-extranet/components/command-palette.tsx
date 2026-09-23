'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  CalendarPlus,
  ClockCounterClockwise,
  DoorOpen,
  MagnifyingGlass,
  SignIn,
  SignOut,
  User,
  Wallet,
} from '@phosphor-icons/react';
import { Dialog, DialogContent, Kbd } from '@yohobed/ui';
import { NAV } from '@/lib/nav';
import { useEntitlements } from '@/lib/queries';
import { searchEverything, type SearchReservation, type SearchResults } from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';
import { useDesk, type DeskTarget } from '@/components/booking/desk-dialogs';

const RECENT_KEY = 'yhb_recent_searches';
const RECENT_MAX = 5;

interface Recent {
  id: string;
  reference: string;
  guestName: string;
}

function readRecents(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? (raw.slice(0, RECENT_MAX) as Recent[]) : [];
  } catch {
    return [];
  }
}

function rememberRecent(r: Recent) {
  try {
    const kept = [r, ...readRecents().filter((x) => x.id !== r.id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch {
    // A convenience only; the search itself works without it.
  }
}

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-2 outline-none transition duration-1 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink';
const groupClass =
  'pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3';

/** What a stay is doing, in the two or three words the desk would use. */
function stayLine(r: SearchReservation, today: string | null): string {
  const when =
    r.checkin === today
      ? 'arriving today'
      : r.checkout === today
        ? 'leaving today'
        : `${r.checkin} → ${r.checkout}`;
  const status =
    r.status === 'CheckedIn'
      ? 'in house'
      : r.status === 'CheckedOut'
        ? 'checked out'
        : r.status === 'Cancelled'
          ? 'cancelled'
          : r.status === 'NoShow'
            ? 'no-show'
            : when;
  const room = r.roomCodes ? ` · room ${r.roomCodes}` : '';
  return `${r.reference} · ${status}${status === when ? '' : ` · ${when}`}${room}`;
}

/**
 * The omni-search — Yanolja's "Search reservations, guests and more", made real in UX-2.
 *
 * It searches the hotel rather than the menu: a reference, a guest's name, the number they booked
 * with however it was written, an OTA voucher, a room number — over every date and every status.
 * The first result is the stay in front of the desk, so Ctrl+K, a word and Enter opens it
 * (docs/UX-STANDARD.md §3, ≤ 2C+1T).
 *
 * A stay that can be checked in, checked out or paid carries that action here too, so the whole
 * job can be done without leaving the keyboard.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { openComposer } = useReservationComposer();
  const { property } = useActiveProperty();
  const desk = useDesk();
  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [recents, setRecents] = React.useState<Recent[]>([]);
  // cmdk highlights nothing when it is not the one filtering, so the highlight is ours to keep:
  // the first result, so Enter opens what the desk was looking for.
  const [highlighted, setHighlighted] = React.useState('');

  const { data: entitlements } = useEntitlements();
  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (i) =>
        (!i.feature || entitlements?.features[i.feature] !== false) &&
        (!i.countries || i.countries.includes(property?.countryCode ?? '')),
    ),
  })).filter((g) => g.items.length > 0);

  // Typing is not a request: wait until the desk stops, then ask once.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(t);
  }, [term]);

  React.useEffect(() => {
    if (open) setRecents(readRecents());
    else {
      setTerm('');
      setDebounced('');
    }
  }, [open]);

  const results = useQuery({
    queryKey: ['search', property?.id, debounced],
    queryFn: () => searchEverything(property!.id, debounced),
    enabled: open && Boolean(property?.id) && debounced.length >= 2,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      // Alt+N: a new reservation from anywhere. `code`, not `key`: on a Mac, Option+N types "˜".
      if (e.code === 'KeyN' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onOpenChange(false);
        openComposer();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, openComposer]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function openStay(r: { id: string; reference: string; guestName: string }) {
    rememberRecent({ id: r.id, reference: r.reference, guestName: r.guestName });
    // The list is filtered to the stay as well as opening it, so what is behind the sheet is the
    // booking that was searched for — and closing the sheet does not lose it.
    const q = r.reference ? `&q=${encodeURIComponent(r.reference)}` : '';
    go(`/app/reservations?bookingId=${r.id}${q}`);
  }

  function runDesk(action: 'check-in' | 'check-out' | 'take-payment', r: SearchReservation) {
    rememberRecent({ id: r.id, reference: r.reference, guestName: r.guestName });
    onOpenChange(false);
    desk(action, {
      id: r.id,
      reference: r.reference,
      guestName: r.guestName,
      checkin: r.checkin,
      checkout: r.checkout,
      currency: r.currency,
    } satisfies DeskTarget);
  }

  const found: SearchResults | undefined = results.data;
  const searching = debounced.length >= 2;
  // Pages are matched here rather than by the server: the menu is in the browser already.
  const matchingNav = visibleGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        `${g.label} ${i.label}`.toLowerCase().includes(debounced.toLowerCase()),
      ),
    }))
    .filter((g) => g.items.length > 0);
  // The server decides what matches, so cmdk's own filtering is off and the list is exactly what
  // came back — in the order it came back, which puts the stay in front of the desk first.
  const nothingFound =
    searching && !results.isFetching && found
      ? found.reservations.length + found.guests.length + found.rooms.length === 0 &&
        matchingNav.length === 0
      : false;

  // The highlight goes on the first result, so Enter opens what was searched for.
  const firstNav = matchingNav[0]?.items[0];
  const firstValue = !searching
    ? ''
    : found?.reservations[0]
      ? `result:${found.reservations[0].id}`
      : found?.rooms[0]
        ? `result:room:${found.rooms[0].id}`
        : found?.guests[0]
          ? `result:guest:${found.guests[0].id}`
          : firstNav
            ? `${matchingNav[0]!.label} ${firstNav.label}`
            : '';
  React.useEffect(() => {
    setHighlighted(firstValue);
  }, [firstValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Search" hideTitle hideClose className="max-w-xl p-0">
        <Command
          loop
          shouldFilter={false}
          value={highlighted}
          onValueChange={setHighlighted}
          className="flex flex-col"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <MagnifyingGlass size={16} className="shrink-0 text-ink-3" />
            <Command.Input
              autoFocus
              value={term}
              onValueChange={setTerm}
              placeholder="Search reservations, guests and more"
              className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
            {results.isFetching ? (
              <span className="text-[11px] text-ink-3">searching…</span>
            ) : (
              <Kbd>Esc</Kbd>
            )}
          </div>

          <Command.List className="max-h-96 overflow-y-auto p-2">
            {nothingFound && (
              <p className="px-2 py-8 text-center text-sm text-ink-3">
                Nothing matches &ldquo;{debounced}&rdquo;. Try the guest&apos;s surname, the
                reference, or the number they booked with.
              </p>
            )}
            {!searching && recents.length === 0 && (
              <p className="px-2 pb-1 pt-3 text-center text-xs text-ink-3">
                Type a name, a reference, a phone number or a room.
              </p>
            )}

            {searching && found && found.reservations.length > 0 && (
              <Command.Group heading="Reservations" className={groupClass}>
                {found.reservations.map((r) => (
                  <React.Fragment key={r.id}>
                    <Command.Item
                      value={`result:${r.id}`}
                      onSelect={() => openStay(r)}
                      className={itemClass}
                    >
                      <User size={16} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink">{r.guestName}</span>
                        {r.vip && <span className="ml-1.5 text-brass">VIP</span>}
                        <span className="block truncate text-xs text-ink-3">
                          {stayLine(r, found.today)}
                        </span>
                      </span>
                    </Command.Item>
                    {r.status === 'Approved' && r.checkin <= (found.today ?? '') && (
                      <Command.Item
                        value={`result:${r.id}:in`}
                        onSelect={() => runDesk('check-in', r)}
                        className={`${itemClass} pl-9`}
                      >
                        <SignIn size={15} className="shrink-0 text-ink-3" /> Check in {r.guestName}
                      </Command.Item>
                    )}
                    {r.status === 'CheckedIn' && (
                      <>
                        <Command.Item
                          value={`result:${r.id}:out`}
                          onSelect={() => runDesk('check-out', r)}
                          className={`${itemClass} pl-9`}
                        >
                          <SignOut size={15} className="shrink-0 text-ink-3" /> Check out{' '}
                          {r.guestName}
                        </Command.Item>
                        <Command.Item
                          value={`result:${r.id}:pay`}
                          onSelect={() => runDesk('take-payment', r)}
                          className={`${itemClass} pl-9`}
                        >
                          <Wallet size={15} className="shrink-0 text-ink-3" /> Take a payment
                        </Command.Item>
                      </>
                    )}
                  </React.Fragment>
                ))}
              </Command.Group>
            )}

            {searching && found && found.rooms.length > 0 && (
              <Command.Group heading="Rooms" className={groupClass}>
                {found.rooms.map((room) => (
                  <Command.Item
                    key={room.id}
                    value={`result:room:${room.id}`}
                    onSelect={() =>
                      room.bookingId
                        ? openStay({
                            id: room.bookingId,
                            reference: room.reference ?? '',
                            guestName: room.guestName ?? '',
                          })
                        : go('/app/roomview')
                    }
                    className={itemClass}
                  >
                    <DoorOpen size={16} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">
                      Room {room.code}
                      <span className="block truncate text-xs text-ink-3">
                        {room.guestName ? `${room.guestName} is in it` : 'nobody in it tonight'}
                      </span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searching && found && found.guests.length > 0 && (
              <Command.Group heading="Guests" className={groupClass}>
                {found.guests.map((g) => (
                  <Command.Item
                    key={g.id}
                    value={`result:guest:${g.id}`}
                    onSelect={() => go(`/app/customers?customerId=${g.id}`)}
                    className={itemClass}
                  >
                    <User size={16} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-ink">{g.name}</span>
                      {g.vip && <span className="ml-1.5 text-brass">VIP</span>}
                      <span className="block truncate text-xs text-ink-3">
                        {[g.phone, g.email, g.stays > 0 ? `${g.stays} stays` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {!searching && recents.length > 0 && (
              <Command.Group heading="Recent" className={groupClass}>
                {recents.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`result:recent:${r.id}`}
                    onSelect={() => openStay(r)}
                    className={itemClass}
                  >
                    <ClockCounterClockwise size={16} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">
                      {r.guestName}
                      <span className="ml-2 font-mono text-xs text-ink-3">{r.reference}</span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {!searching && (
              <Command.Group heading="Actions" className={groupClass}>
                <Command.Item
                  value="New reservation booking walk-in quick"
                  onSelect={() => {
                    onOpenChange(false);
                    openComposer();
                  }}
                  className={itemClass}
                >
                  <CalendarPlus size={16} className="shrink-0 text-ink-3" />
                  New reservation
                  <span className="ml-auto flex gap-1">
                    <Kbd>Alt</Kbd>
                    <Kbd>N</Kbd>
                  </span>
                </Command.Item>
              </Command.Group>
            )}

            {/* A page can be searched for by name too — typing "promotions" should go there. */}
            {(searching ? matchingNav : visibleGroups).map((group) => (
              <Command.Group key={group.label} heading={group.label} className={groupClass}>
                {group.items.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${group.label} ${item.label}`}
                    onSelect={() => go(item.href)}
                    className={itemClass}
                  >
                    <item.icon size={16} className="shrink-0 text-ink-3" />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>

          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2.5 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd> close
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Kbd>?</Kbd> shortcuts
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
