'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Broom, CalendarBlank, DoorOpen } from '@phosphor-icons/react';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  Field,
  InlineAlert,
  Skeleton,
  Textarea,
  cn,
} from '@yohobed/ui';
import {
  assignRooms,
  changeDeparture,
  commitStayChange,
  describeError,
  moveRoom,
  previewDepartureChange,
  previewStayChange,
  type StayBar,
  type StayUnit,
} from '@/lib/api';
import { useMoney } from '@/components/currency';
import { useUxTask } from '@/lib/ux';
import { daysBetween, nightsLabel, shortDate, stayRange } from './model/dates';
import { HK_META } from './model/status';

/**
 * The review step behind every change made by pointer on the calendar. A drag only proposes;
 * these dialogs say exactly what will change — rooms, nights, money — and save it with the
 * version the review was made on, so a change another desk made in between is refused, not
 * overwritten.
 */

function RoomTag({ unit, typeName }: { unit: StayUnit | null; typeName?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="font-mono text-sm font-semibold text-ink">{unit ? unit.code : 'No room'}</div>
      <div className="truncate text-[11px] text-ink-3">
        {unit?.displayName ? `${unit.displayName} · ` : ''}
        {typeName ?? ''}
      </div>
    </div>
  );
}

export interface MoveProposal {
  bar: StayBar;
  from: StayUnit | null;
  to: StayUnit;
}

/** Moving a stay to another room of the same type (or giving an unassigned stay its room). */
export function RoomMoveReview({
  proposal,
  typeName,
  today,
  onClose,
  onDone,
}: {
  proposal: MoveProposal | null;
  typeName: (roomId?: string) => string | undefined;
  today: string;
  onClose: () => void;
  onDone: (bookingId: string, message: string) => void;
}) {
  const ux = useUxTask('stay.move_room', !!proposal);
  const bar = proposal?.bar;
  const inHouse = bar?.status === 'CheckedIn';
  const assign = !bar?.roomUnitId;
  const splitAt = inHouse && bar && bar.from < today ? today : null;
  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const { bar, to } = proposal!;
      return assign
        ? assignRooms(bar.bookingId!, [
            { legId: bar.id, roomUnitId: to.id, expectedUpdatedAt: bar.legUpdatedAt },
          ])
        : moveRoom(bar.bookingId!, {
            legId: bar.id,
            toRoomUnitId: to.id,
            expectedUpdatedAt: bar.legUpdatedAt,
          });
    },
    onSuccess: () => {
      ux.complete();
      const { bar, to } = proposal!;
      onDone(
        bar.bookingId!,
        assign
          ? `${bar.guestName ?? 'The guest'} is in room ${to.code}`
          : `${bar.guestName ?? 'The guest'} moved to room ${to.code}`,
      );
    },
  });
  React.useEffect(() => save.reset(), [proposal]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty =
    proposal &&
    inHouse &&
    proposal.to.housekeeping !== 'clean' &&
    proposal.to.housekeeping !== 'inspected';

  return (
    <Dialog open={!!proposal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          proposal
            ? assign
              ? `Put ${bar!.guestName ?? 'this stay'} in room ${proposal.to.code}?`
              : `Move ${bar!.guestName ?? 'this stay'} to room ${proposal.to.code}?`
            : 'Move room'
        }
        className="max-w-lg"
      >
        {proposal && bar && (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex items-center gap-3">
              <RoomTag unit={proposal.from} typeName={typeName(proposal.from?.roomId)} />
              <ArrowRight size={16} className="shrink-0 text-ink-3" aria-hidden />
              <RoomTag unit={proposal.to} typeName={typeName(proposal.to.roomId)} />
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <CalendarBlank size={15} className="text-ink-3" aria-hidden />
              {stayRange(bar.from, bar.to)} · {nightsLabel(daysBetween(bar.from, bar.to))} · same
              room type, agreed rate unchanged
            </p>
            {splitAt && (
              <div className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold text-ink">The stay splits at today</p>
                <div className="mt-2 flex h-7 overflow-hidden rounded-md text-[11px] font-semibold">
                  <div
                    className="flex items-center justify-center bg-surface-2 text-ink-2"
                    style={{ flex: daysBetween(bar.from, splitAt) }}
                  >
                    {proposal.from?.code} · stayed
                  </div>
                  <div
                    className="flex items-center justify-center bg-avail text-white"
                    style={{ flex: daysBetween(splitAt, bar.to) }}
                  >
                    {proposal.to.code} · from {shortDate(splitAt)}
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  Nights already stayed remain on room {proposal.from?.code}’s record; room{' '}
                  {proposal.from?.code} is marked dirty for housekeeping.
                </p>
              </div>
            )}
            {dirty && (
              <InlineAlert tone="warn">
                Room {proposal.to.code} is {HK_META[proposal.to.housekeeping].label.toLowerCase()}.
                An in-house guest can only move into a ready room — mark it clean first.
              </InlineAlert>
            )}
            {save.isError && (
              <InlineAlert tone="error">
                {describeError(save.error, 'The move was not saved')}
              </InlineAlert>
            )}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} data-autofocus>
            <DoorOpen size={15} aria-hidden /> {assign ? 'Assign room' : 'Move guest'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface DateProposal {
  bar: StayBar;
  from: string;
  to: string;
}

/**
 * New dates for a stay — a whole-stay move, a new departure, or dates typed in. Nights that stay
 * keep the price they were sold at; new nights are priced now. An in-house stay changes through
 * the departure workflow (it keeps a complimentary or overridden rate and can also shorten).
 */
export function DateChangeReview({
  proposal,
  today,
  currency,
  onClose,
  onDone,
}: {
  proposal: DateProposal | null;
  today: string;
  currency: string;
  onClose: () => void;
  onDone: (bookingId: string, message: string) => void;
}) {
  const { money } = useMoney();
  const bar = proposal?.bar;
  const inHouse = bar?.status === 'CheckedIn';
  const ux = useUxTask('stay.change_dates', !!proposal);
  const [dates, setDates] = React.useState({ from: '', to: '' });
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (proposal) setDates({ from: proposal.from, to: proposal.to });
    setReason('');
  }, [proposal]);
  const valid = !!dates.from && !!dates.to && dates.to > dates.from;
  const unchanged = !!bar && dates.from === bar.from && dates.to === bar.to;

  const review = useQuery({
    queryKey: ['stay-change-review', bar?.bookingId, inHouse, dates.from, dates.to],
    enabled: !!bar?.bookingId && valid && !unchanged,
    retry: false,
    queryFn: async () => {
      if (inHouse) {
        const r = await previewDepartureChange(bar!.bookingId!, dates.to);
        if (!r.ok) throw new Error(r.problem?.message ?? 'This departure cannot be changed.');
        return { ...r, conflicts: [] as string[] };
      }
      return previewStayChange(bar!.bookingId!, dates.from, dates.to);
    },
  });
  const data = review.data;
  const fresh = !!data && !review.isFetching && data.proposed.checkout === dates.to;
  const save = useMutation({
    mutationFn: () =>
      inHouse
        ? changeDeparture(bar!.bookingId!, dates.to, reason.trim(), data!.expectedUpdatedAt)
        : commitStayChange(data as Parameters<typeof commitStayChange>[0]),
    onSuccess: () => {
      ux.complete();
      onDone(
        bar!.bookingId!,
        inHouse
          ? `${bar!.guestName ?? 'The guest'} now leaves ${shortDate(dates.to)}`
          : `${bar!.guestName ?? 'The stay'} moved to ${stayRange(dates.from, dates.to)}`,
      );
    },
  });
  React.useEffect(() => save.reset(), [proposal, dates.from, dates.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const difference = data ? Number(data.proposed.difference) : 0;
  const needsReason = inHouse && reason.trim().length < 3;

  return (
    <Dialog open={!!proposal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          bar
            ? inHouse
              ? `Change ${bar.guestName ?? 'the'}’s departure`
              : `New dates for ${bar.guestName ?? 'this stay'}`
            : 'Change dates'
        }
        className="max-w-lg"
      >
        {bar && (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Arrival">
                <DatePicker
                  value={dates.from}
                  today={today}
                  disabled={inHouse}
                  aria-label="Arrival"
                  onChange={(iso) => setDates((d) => ({ ...d, from: iso }))}
                />
              </Field>
              <Field label="Departure">
                <DatePicker
                  value={dates.to}
                  today={today}
                  min={inHouse ? today : undefined}
                  rangeStart={dates.from}
                  aria-label="Departure"
                  onChange={(iso) => setDates((d) => ({ ...d, to: iso }))}
                />
              </Field>
            </div>

            <div className="rounded-lg border border-line text-sm" aria-label="Review stay change">
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-line px-3 py-2.5">
                <span className="text-ink-3">Now</span>
                <span className="text-right font-mono tabular-nums text-ink-2">
                  {stayRange(bar.from, bar.to)} · {nightsLabel(daysBetween(bar.from, bar.to))}
                  {data && ` · ${money(data.old.amount, currency)}`}
                </span>
                <span className="font-semibold text-ink">After the change</span>
                <span className="text-right font-mono font-semibold tabular-nums text-ink">
                  {valid
                    ? `${stayRange(dates.from, dates.to)} · ${nightsLabel(daysBetween(dates.from, dates.to))}`
                    : '—'}
                  {data && fresh && ` · ${money(data.proposed.amount, currency)}`}
                </span>
              </div>
              {review.isFetching && (
                <div className="space-y-1.5 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              )}
              {data && fresh && (
                <>
                  <div
                    className={cn(
                      'flex items-center justify-between px-3 py-2 font-semibold',
                      difference > 0
                        ? 'text-low-ink'
                        : difference < 0
                          ? 'text-avail-ink'
                          : 'text-ink-2',
                    )}
                  >
                    <span>Difference</span>
                    <span className="font-mono tabular-nums">
                      {difference > 0 ? '+' : ''}
                      {money(data.proposed.difference, currency)}
                    </span>
                  </div>
                  <ul className="max-h-36 overflow-auto border-t border-line px-3 py-2 text-xs">
                    {data.nights.map((n) => (
                      <li key={n.date} className="flex justify-between py-0.5">
                        <span className="text-ink-2">
                          {shortDate(n.date)}{' '}
                          <span className="text-ink-3">
                            {n.retained ? '· agreed rate kept' : '· priced today'}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums text-ink">
                          {money(n.amount, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {data && fresh && data.conflicts.length > 0 && (
              <InlineAlert tone="warn">
                The room is taken on some of the new nights. Move the guest to a free room first,
                then change the dates.
              </InlineAlert>
            )}
            {review.isError && (
              <InlineAlert tone="error">
                {describeError(review.error, 'These dates cannot be reviewed')}
              </InlineAlert>
            )}
            {inHouse && (
              <Field label="Why is the stay changing?" required>
                <Textarea
                  value={reason}
                  rows={2}
                  maxLength={300}
                  placeholder="Guest asked for two more nights"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            {save.isError && (
              <InlineAlert tone="error">
                {describeError(save.error, 'The change was not saved')}
              </InlineAlert>
            )}
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              <Broom size={13} aria-hidden /> Saving re-checks availability and the price; nothing
              changes until you confirm.
            </p>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!fresh || unchanged || (data?.conflicts.length ?? 0) > 0 || needsReason}
          >
            Save reviewed change
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
