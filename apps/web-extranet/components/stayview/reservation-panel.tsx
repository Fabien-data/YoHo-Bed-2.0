'use client';
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Sheet, SheetContent } from '@yohobed/ui';
import {
  assignRooms,
  autoAssignRooms,
  getBookingLegs,
  getBookingStay,
  getBookingGuests,
  confirmBooking,
  listRoomUnits,
  moveRoom,
  previewStayChange,
  commitStayChange,
  releaseBlock,
  type StayBar,
  type StayView,
} from '@/lib/api';
import { FolioPanel } from '@/components/folio/folio-panel';
import { DeskActionBar } from '@/components/booking/desk-action-bar';
import { addDays } from './calendar-model';
import { useCalendarAccess } from './use-calendar-preferences';
import { ReservationNotes } from './reservation-notes';
/** The right slide-over Yanolja opens on every bar. */
export function ReservationSheet({
  bar,
  droppedRoom,
  proposedDates,
  calendar,
  propertyId,
  currency,
  onClose,
  onChanged,
  onUpdatedBar,
  wide = false,
}: {
  wide?: boolean;
  bar: StayBar | null;
  droppedRoom: string | null;
  proposedDates: { checkin: string; checkout: string } | null;
  calendar?: StayView;
  propertyId?: string;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
  onUpdatedBar: (bar: StayBar) => void;
}) {
  const { can, legacy } = useCalendarAccess();
  const [releaseReview, setReleaseReview] = React.useState(false);
  const open = bar !== null;
  const isBlock = bar?.kind === 'block';
  const [review, setReview] = React.useState<{ legId: string; toRoomUnitId: string | null } | null>(
    null,
  );
  const [dates, setDates] = React.useState({ checkin: '', checkout: '' });
  const guests = useQuery({
    queryKey: ['booking-guests', bar?.bookingId],
    queryFn: () => getBookingGuests(bar!.bookingId!),
    enabled: !!bar?.bookingId && can('financial_read', 'reservation_read'),
  });
  const confirm = useMutation({
    mutationFn: () => confirmBooking(bar!.bookingId!),
    onSuccess: () => {
      onChanged();
    },
  });
  React.useEffect(
    () =>
      setReview(
        droppedRoom && bar?.kind === 'booking'
          ? { legId: bar.id, toRoomUnitId: droppedRoom }
          : null,
      ),
    [bar?.id, bar?.kind, droppedRoom],
  );
  React.useEffect(
    () => setDates(proposedDates ?? { checkin: bar?.from ?? '', checkout: bar?.to ?? '' }),
    [bar?.id, bar?.from, bar?.to, proposedDates],
  );

  const legs = useQuery({
    queryKey: ['booking-legs', bar?.bookingId],
    queryFn: () => getBookingLegs(bar!.bookingId!),
    enabled: open && !!bar?.bookingId,
  });

  const units = useQuery({
    queryKey: ['room-units', propertyId],
    queryFn: () => listRoomUnits(propertyId!),
    enabled: open && !!propertyId,
  });

  const assign = useMutation({
    mutationFn: (v: { legId: string; roomUnitId: string | null; expectedUpdatedAt?: string }) =>
      assignRooms(bar!.bookingId!, [v]),
    onSuccess: () => {
      legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const autoAssign = useMutation({
    mutationFn: () => autoAssignRooms(bar!.bookingId!),
    onSuccess: () => {
      void legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const move = useMutation({
    mutationFn: (v: { legId: string; toRoomUnitId: string; expectedUpdatedAt: string }) =>
      moveRoom(bar!.bookingId!, v),
    onSuccess: () => {
      void legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const stayPreview = useMutation({
    mutationFn: (proposal?: { checkin: string; checkout: string }) => {
      const next = proposal ?? dates;
      return previewStayChange(bar!.bookingId!, next.checkin, next.checkout);
    },
  });
  const bookingStay = useQuery({
    queryKey: ['booking-stay', bar?.bookingId],
    queryFn: () => getBookingStay(bar!.bookingId!),
    enabled: open && bar?.status === 'CheckedIn' && !!bar.bookingId,
  });
  React.useEffect(() => {
    if (bookingStay.data && bar?.status === 'CheckedIn' && !proposedDates)
      setDates({ checkin: bookingStay.data.checkin, checkout: bookingStay.data.checkout });
  }, [bookingStay.data, bar?.status, proposedDates]);
  React.useEffect(() => {
    stayPreview.reset();
    stayCommit.reset();
    assign.reset();
    move.reset();
    autoAssign.reset();
    unblock.reset();
    setReleaseReview(false);
  }, [bar?.id]);
  React.useEffect(() => {
    if (proposedDates && bar?.kind === 'booking' && bar.source !== 'OTA') {
      stayPreview.mutate(proposedDates);
    }
    // The proposal object is created only by a completed resize gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar?.id, proposedDates]);
  const stayCommit = useMutation({
    mutationFn: () => commitStayChange(stayPreview.data!),
    onSuccess: (booking) => {
      onUpdatedBar({ ...bar!, from: booking.checkin, to: booking.checkout });
      onChanged();
      stayPreview.reset();
      void legs.refetch();
    },
  });

  const unblock = useMutation({
    mutationFn: () => releaseBlock(bar!.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  const bookedCategory =
    calendar?.roomTypes.find((group) =>
      group.units.some((unit) => unit.bars.some((item) => item.id === bar?.id)),
    )?.roomId ?? calendar?.unassigned.find((item) => item.id === bar?.id)?.roomId;
  const chosenLeg = legs.data?.find((leg) => leg.id === review?.legId);
  const destination = units.data?.find((unit) => unit.id === review?.toRoomUnitId);
  const destinationCalendar = calendar?.roomTypes
    .flatMap((group) => group.units)
    .find((unit) => unit.id === review?.toRoomUnitId);
  const conflicts =
    (chosenLeg &&
      destinationCalendar?.bars.filter(
        (item) =>
          item.id !== chosenLeg.id && item.from < chosenLeg.checkout && chosenLeg.checkin < item.to,
      )) ||
    [];

  return (
    <Sheet modal={false} open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        showOverlay={false}
        wide={wide}
        onInteractOutside={(event) => event.preventDefault()}
        title={isBlock ? 'Room blocked' : (bar?.guestName ?? 'Reservation')}
        description={isBlock ? bar?.reason : bar?.reference}
      >
        {!bar ? null : isBlock ? (
          <div className="space-y-4">
            <InfoRow label="Reason" value={bar.reason ?? '—'} />
            <InfoRow label="From" value={bar.from} />
            <InfoRow label="To" value={bar.to} />
            <Button
              variant="secondary"
              onClick={() => (releaseReview ? unblock.mutate() : setReleaseReview(true))}
              disabled={unblock.isPending || !can('reservation_change')}
            >
              {unblock.isPending
                ? 'Unblocking…'
                : releaseReview
                  ? 'Confirm release to inventory'
                  : 'Unblock room'}
            </Button>
            {releaseReview && (
              <p className="text-sm text-ink-2">
                Release this block and make these nights available for sale?
              </p>
            )}
            {unblock.isError && <p className="text-sm text-closed-ink">{String(unblock.error)}</p>}
          </div>
        ) : (
          <div className="space-y-5">
            {bar.reservationKind === 'inquiry' && can('reservation_change', 'financial_read') && (
              <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                {confirm.isPending ? 'Confirming…' : 'Confirm reservation'}
              </Button>
            )}
            {confirm.isError && (
              <p role="alert" className="text-sm text-closed-ink">
                {String(confirm.error)}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={bar.status === 'CheckedIn' ? 'avail' : 'brand'}>{bar.status}</Badge>
              {bar.balanceDue && <Badge tone="closed">Payment pending</Badge>}
              <Badge tone="muted" dot={false}>
                {bar.channel ?? bar.source}
              </Badge>
            </div>

            {bar.bookingId && can('financial_read', 'check_in_out') && legacy && (
              <DeskActionBar
                status={bar.status ?? ''}
                booking={{
                  id: bar.bookingId,
                  reference: bar.reference ?? '',
                  guestName: bar.guestName ?? 'the guest',
                  checkin: bar.from,
                  checkout: bar.to,
                }}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Reservation" value={bar.reference ?? '—'} />
              <InfoRow label="Guest" value={bar.guestName ?? '—'} />
              <InfoRow label="Arrival" value={bar.from} />
              <InfoRow label="Departure" value={bar.to} />
              <InfoRow
                label="Guests"
                value={`${bar.adults ?? '—'} adults · ${bar.children ?? 0} children`}
              />
              <InfoRow
                label="Room category"
                value={
                  calendar?.roomTypes.find((category) => category.roomId === bar.roomId)?.name ??
                  '—'
                }
              />
              {bar.amount !== undefined && can('financial_read') && (
                <InfoRow
                  label="Total / balance"
                  value={`${currency} ${bar.amount} / ${bar.balance}`}
                />
              )}
              {guests.data?.primary?.email && (
                <InfoRow label="Email" value={guests.data.primary.email} />
              )}
              {guests.data?.primary?.phone && (
                <InfoRow label="Phone" value={guests.data.primary.phone} />
              )}
            </div>

            {(bar.status === 'Pending' ||
              bar.status === 'Approved' ||
              bar.status === 'CheckedIn') &&
              bar.source !== 'OTA' &&
              can('reservation_change', 'financial_read') && (
                <div className="rounded-xl border border-line p-3">
                  <h3 className="mb-2 text-sm font-bold text-ink">
                    {bar.status === 'CheckedIn' ? 'Extend stay' : 'Change stay dates'}
                  </h3>
                  {proposedDates && (
                    <p className="mb-2 rounded-lg bg-brand-soft px-3 py-2 text-xs font-semibold text-brand-ink">
                      Departure moved on the calendar. Review availability and the price difference
                      before saving.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-semibold text-ink-2">
                      Arrival
                      <Input
                        type="date"
                        disabled={bar.status === 'CheckedIn'}
                        value={dates.checkin}
                        onChange={(event) => {
                          setDates({ ...dates, checkin: event.target.value });
                          stayPreview.reset();
                        }}
                      />
                    </label>
                    <label className="text-xs font-semibold text-ink-2">
                      Departure
                      <Input
                        type="date"
                        min={bar.status === 'CheckedIn' ? addDays(bar.to, 1) : undefined}
                        value={dates.checkout}
                        onChange={(event) => {
                          setDates({ ...dates, checkout: event.target.value });
                          stayPreview.reset();
                        }}
                      />
                    </label>
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    disabled={
                      stayPreview.isPending ||
                      !dates.checkin ||
                      !dates.checkout ||
                      dates.checkout <= dates.checkin ||
                      (dates.checkin === bar.from && dates.checkout === bar.to)
                    }
                    onClick={() => stayPreview.mutate(dates)}
                  >
                    Review date and price change
                  </Button>
                  {stayPreview.isError && (
                    <p className="mt-2 text-sm text-closed-ink">{String(stayPreview.error)}</p>
                  )}
                  {stayPreview.data && (
                    <div
                      className="mt-3 space-y-2 rounded-lg bg-surface-2 p-3 text-sm"
                      aria-label="Review stay change"
                    >
                      <p>
                        <strong>Current:</strong> {stayPreview.data.old.checkin} →{' '}
                        {stayPreview.data.old.checkout} · {currency} {stayPreview.data.old.amount}
                      </p>
                      <p>
                        <strong>Proposed:</strong> {stayPreview.data.proposed.checkin} →{' '}
                        {stayPreview.data.proposed.checkout} · {currency}{' '}
                        {stayPreview.data.proposed.amount}
                      </p>
                      <p>
                        <strong>Difference:</strong> {currency}{' '}
                        {stayPreview.data.proposed.difference}
                      </p>
                      <div className="max-h-28 overflow-auto border-t border-line pt-2">
                        {stayPreview.data.nights.map((night) => (
                          <p key={night.date} className="flex justify-between">
                            <span>
                              {night.date}{' '}
                              {night.retained ? '· agreed rate kept' : '· current rate'}
                            </span>
                            <span>{night.amount}</span>
                          </p>
                        ))}
                      </div>
                      {stayPreview.data.conflicts.length > 0 && (
                        <p className="text-closed-ink">
                          Assigned room conflict on the proposed dates. Move the booking to an
                          available room first.
                        </p>
                      )}
                      <Button
                        size="sm"
                        disabled={stayCommit.isPending || stayPreview.data.conflicts.length > 0}
                        onClick={() => stayCommit.mutate()}
                      >
                        {stayCommit.isPending ? 'Saving…' : 'Save reviewed change'}
                      </Button>
                      {stayCommit.isError && (
                        <p className="text-closed-ink">{String(stayCommit.error)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            {bar.source === 'OTA' && (
              <p className="text-xs text-ink-3">
                OTA date amendments require provider support. Internal room allocation is available
                below.
              </p>
            )}

            {bar.bookingId && (
              <ReservationNotes
                key={bar.bookingId}
                bookingId={bar.bookingId}
                editable={can('reservation_change')}
              />
            )}
            {bar.bookingId && can('financial_read') && legacy && (
              <details>
                <summary className="cursor-pointer text-sm font-bold text-ink">
                  Bill and payments
                </summary>
                <FolioPanel bookingId={bar.bookingId} />
              </details>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Rooms</h3>
                {bar.bookingId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => autoAssign.mutate()}
                    disabled={
                      !can('room_assignment') ||
                      autoAssign.isPending ||
                      legs.isPending ||
                      bar.status === 'CheckedIn' ||
                      !(legs.data ?? []).some((leg) => !leg.roomUnitId)
                    }
                  >
                    {autoAssign.isPending ? 'Assigning…' : 'Auto-assign rooms'}
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {(legs.data ?? []).map((leg) => (
                  <div
                    key={leg.id}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <span className="text-xs text-ink-3">Room {leg.legIndex + 1}</span>
                    <select
                      aria-label={`Assign room ${leg.legIndex + 1}`}
                      disabled={
                        !can('room_assignment') ||
                        bar.status === 'CheckedOut' ||
                        bar.status === 'Cancelled'
                      }
                      value={leg.roomUnitId ?? ''}
                      onChange={(e) =>
                        setReview({ legId: leg.id, toRoomUnitId: e.target.value || null })
                      }
                      className="ml-auto rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink"
                    >
                      <option value="">Unassigned</option>
                      {(units.data ?? [])
                        .filter(
                          (u) =>
                            u.status === 'active' &&
                            (!bookedCategory || u.roomId === bookedCategory),
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                            {u.displayName ? ` · ${u.displayName}` : ''} · {u.roomName}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>

              {review && chosenLeg && (
                <div
                  className="mt-4 rounded-xl border border-brand bg-surface-2 p-4"
                  aria-label="Review room change"
                >
                  <h4 className="text-sm font-bold text-ink">Review room change</h4>
                  <p className="mt-2 text-sm text-ink-2">
                    {chosenLeg.code ?? 'Unassigned'}
                    {chosenLeg.displayName ? ` · ${chosenLeg.displayName}` : ''} →{' '}
                    {destination
                      ? `${destination.code}${destination.displayName ? ` · ${destination.displayName}` : ''}`
                      : 'Unassigned'}
                  </p>
                  <p className="text-sm text-ink-2">
                    {chosenLeg.checkin} → {chosenLeg.checkout} · Same category · Agreed rate
                    unchanged
                  </p>
                  {bar.status === 'CheckedIn' && (
                    <p className="mt-2 text-sm text-ink-2">
                      Completed nights stay in the original room. Only the remaining stay moves.
                    </p>
                  )}
                  {destinationCalendar?.housekeeping === 'dirty' && (
                    <p className="mt-2 text-sm text-closed-ink">
                      The room is dirty today. Clean it before check-in.
                    </p>
                  )}
                  {conflicts.length > 0 && (
                    <p className="mt-2 text-sm text-closed-ink">
                      This room overlaps {conflicts.length} booking or block. Choose another room.
                    </p>
                  )}
                  {bar.status === 'CheckedIn' && !review.toRoomUnitId && (
                    <p className="mt-2 text-sm text-closed-ink">
                      An in-house room cannot be unassigned.
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (
                          bar.status === 'CheckedIn' &&
                          review.toRoomUnitId &&
                          chosenLeg.roomUnitId
                        )
                          move.mutate({
                            legId: chosenLeg.id,
                            toRoomUnitId: review.toRoomUnitId,
                            expectedUpdatedAt: chosenLeg.updatedAt,
                          });
                        else
                          assign.mutate({
                            legId: chosenLeg.id,
                            roomUnitId: review.toRoomUnitId,
                            expectedUpdatedAt: chosenLeg.updatedAt,
                          });
                      }}
                      disabled={
                        !can('room_assignment') ||
                        assign.isPending ||
                        move.isPending ||
                        conflicts.length > 0 ||
                        (bar.status === 'CheckedIn' && !review.toRoomUnitId)
                      }
                    >
                      {assign.isPending || move.isPending ? 'Saving…' : 'Save change'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReview(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {assign.isError && (
                <p className="mt-2 text-sm text-closed-ink">
                  {(assign.error as { data?: { message?: string } })?.data?.message ??
                    'That room is not available for those dates.'}
                </p>
              )}
              {autoAssign.isError && (
                <p className="mt-2 text-sm text-closed-ink">
                  {(autoAssign.error as { data?: { message?: string } })?.data?.message ??
                    'No suitable room is available for every unassigned stay.'}
                </p>
              )}
              {move.isError && <p className="mt-2 text-sm text-closed-ink">{String(move.error)}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A label/value display row (renamed from `Field` so it cannot shadow the kit's form Field). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
