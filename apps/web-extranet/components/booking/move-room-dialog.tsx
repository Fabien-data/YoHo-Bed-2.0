'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Broom, DoorOpen } from '@phosphor-icons/react';
import { Button, Dialog, DialogContent, InlineAlert, Skeleton, cn, toast } from '@yohobed/ui';
import {
  describeError,
  getBookingLegs,
  getRoomAvailability,
  moveRoom,
  type BookingLeg,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { useReservationConfig } from '@/lib/queries';
import { useUxTask } from '@/lib/ux';
import { useRefreshDesk } from './refresh';
import type { DeskBooking } from './check-in-dialog';

interface Target extends DeskBooking {
  checkin: string;
  checkout: string;
  status?: string;
}

/**
 * Moving a guest to another room (UX-2).
 *
 * Only rooms of the booked type that are free for every remaining night are offered, and for a
 * guest already in house only ready ones — the desk never picks a room the server will refuse. A
 * change of room type is a different job (it re-prices the stay) and goes through the
 * reservation. Open, pick, move: three presses (docs/UX-STANDARD.md §3).
 */
export function MoveRoomDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Target | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDesk();
  const { propertyId } = useActiveProperty();
  const ux = useUxTask('stay.move_room', open);
  const id = booking?.id ?? '';
  const [legId, setLegId] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState<string | null>(null);

  const config = useReservationConfig(propertyId);
  const today = config.data?.calendarToday ?? '';
  // An in-house guest moves from today on, so only the nights still ahead must be free.
  const from = booking && today > booking.checkin ? today : (booking?.checkin ?? '');
  const legs = useQuery({
    queryKey: ['booking-legs', id],
    queryFn: () => getBookingLegs(id),
    enabled: open && Boolean(id),
  });
  const grid = useQuery({
    queryKey: ['room-availability', propertyId, from, booking?.checkout],
    queryFn: () => getRoomAvailability(propertyId!, { checkin: from, checkout: booking!.checkout }),
    enabled: open && Boolean(propertyId && booking && from && from < booking.checkout),
  });

  // Segments already slept in (a stay moved before) are history, not something to move.
  const live = (legs.data ?? []).filter(
    (l: BookingLeg) => !l.releasedAt && (!today || l.checkout > today),
  );
  const leg = live.find((l) => l.id === legId) ?? live[0] ?? null;

  React.useEffect(() => {
    if (open) {
      setLegId(null);
      setUnitId(null);
    }
  }, [open]);

  const move = useMutation({
    mutationFn: () =>
      moveRoom(id, { legId: leg!.id, toRoomUnitId: unitId!, expectedUpdatedAt: leg!.updatedAt }),
    onSuccess: () => {
      ux.complete();
      refresh();
      const to = options.find((o) => o.id === unitId);
      toast.success(`${booking!.guestName} moved to room ${to?.code ?? ''}`.trim());
      onOpenChange(false);
    },
  });

  // Free rooms of the booked type (the server refuses any other), and for an in-house guest only
  // ready ones: a same-day in-house move requires a clean (or inspected) destination.
  const options = (grid.data?.roomTypes ?? [])
    .filter((t) => t.units.some((u) => u.id === leg?.roomUnitId))
    .flatMap((t) =>
      t.units
        .filter(
          (u) =>
            u.free &&
            !u.outOfService &&
            !u.blocked &&
            u.id !== leg?.roomUnitId &&
            (booking?.status !== 'CheckedIn' ||
              u.housekeeping === 'clean' ||
              u.housekeeping === 'inspected'),
        )
        .map((u) => ({ ...u, roomType: t.name })),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={booking ? `Move ${booking.guestName}` : 'Move room'}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          {legs.isLoading || grid.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !leg ? (
            <InlineAlert tone="warn">This stay has no room to move.</InlineAlert>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <DoorOpen size={16} className="text-ink-3" />
                {leg.code ? `Room ${leg.code}` : 'No room yet'}
                <ArrowRight size={14} className="text-ink-3" />
                {unitId ? (
                  <span className="font-semibold text-ink">
                    Room {options.find((o) => o.id === unitId)?.code}
                  </span>
                ) : (
                  <span className="text-ink-3">choose a room</span>
                )}
              </p>

              {live.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {live.map((l) => (
                    <Button
                      key={l.id}
                      size="sm"
                      variant={l.id === leg.id ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setLegId(l.id);
                        setUnitId(null);
                      }}
                    >
                      {l.code ? `Room ${l.code}` : `Room ${l.legIndex + 1}`}
                    </Button>
                  ))}
                </div>
              )}

              {options.length === 0 ? (
                <InlineAlert tone="warn">
                  {booking?.status === 'CheckedIn'
                    ? 'No other ready room of this type is free for the stay. Clean a room or change the stay first.'
                    : 'No other room of this type is free for every night of this stay. Shorten the stay or move another guest first.'}
                </InlineAlert>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="Free rooms"
                  className="flex max-h-72 flex-wrap gap-2 overflow-y-auto"
                >
                  {options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={unitId === o.id}
                      onClick={() => setUnitId(o.id)}
                      className={cn(
                        'flex min-w-[5.5rem] flex-col items-start rounded-lg border px-3 py-2 text-left transition duration-1',
                        unitId === o.id
                          ? 'border-brand bg-brand-soft text-brand-ink'
                          : 'border-line hover:border-ink-3',
                      )}
                    >
                      <span className="font-mono text-sm font-semibold">{o.code}</span>
                      <span className="text-[11px] text-ink-3">
                        {o.roomType}
                        {o.floor ? ` · floor ${o.floor}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="flex items-center gap-1.5 text-xs text-ink-3">
                <Broom size={13} /> Only rooms free for every night of this stay are listed.
              </p>
              {move.isError && <InlineAlert tone="error">{describeError(move.error)}</InlineAlert>}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={() => move.mutate()} disabled={!unitId || !leg} loading={move.isPending}>
            Move
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
