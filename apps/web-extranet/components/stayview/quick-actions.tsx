'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Sheet, SheetContent } from '@yohobed/ui';
import { createBlock, describeError, type StayView } from '@/lib/api';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';
import { addDays, daysBetween } from './calendar-model';
import { useCalendarAccess } from './use-calendar-preferences';

export interface SelectedRange {
  unitId?: string;
  from: string;
  to: string;
}
export function QuickActions({
  range,
  data,
  propertyId,
  onClose,
  onSaved,
}: {
  range: SelectedRange | null;
  data?: StayView;
  propertyId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { openComposer } = useReservationComposer();
  const { can } = useCalendarAccess();
  const [action, setAction] = React.useState('');
  const [unitId, setUnitId] = React.useState('');
  const [dates, setDates] = React.useState({ from: '', to: '' });
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    setAction('');
    setUnitId(range?.unitId ?? '');
    setDates({ from: range?.from ?? '', to: range?.to ?? '' });
    setReason('');
  }, [range]);
  const units = data?.roomTypes.flatMap((category) => category.units) ?? [];
  const unit = units.find((candidate) => candidate.id === unitId);
  const save = useMutation({
    mutationFn: () =>
      createBlock(propertyId!, {
        roomUnitId: unitId,
        blockFrom: dates.from,
        blockTo: dates.to,
        reason: `${action}: ${reason.trim()}`,
      }),
    onSuccess: () => {
      onSaved(`${action} saved for room ${unit?.code}.`);
      onClose();
    },
  });
  React.useEffect(() => {
    save.reset();
  }, [range]);
  const reserve = (hold = false) => {
    openComposer({
      checkin: dates.from,
      nights: daysBetween(dates.from, dates.to),
      roomId: unit?.roomId,
      roomUnitId: unit?.id,
      kind: hold ? 'hold_confirm' : 'confirm',
    });
    onClose();
  };
  return (
    <Sheet open={!!range} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title="Quick actions"
        description={
          range ? `${range.from} → ${range.to}${unit ? ` · ${unit.code}` : ''}` : undefined
        }
      >
        {!action ? (
          <div className="grid gap-2">
            <Button
              disabled={!can('reservation_change', 'financial_read')}
              onClick={() => reserve()}
            >
              New reservation
            </Button>
            <Button
              variant="secondary"
              disabled={!can('reservation_change', 'financial_read')}
              onClick={() => reserve(true)}
            >
              Courtesy hold
            </Button>
            {['Block dates', 'Out of service', 'Maintenance'].map((label) => (
              <Button
                key={label}
                variant="secondary"
                disabled={!can('reservation_change')}
                onClick={() => setAction(label)}
              >
                {label}
              </Button>
            ))}
            <p className="mt-2 text-xs text-ink-3">
              A courtesy hold reserves inventory until its release time. Blocks remove a room from
              sale for the selected nights.
            </p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <label className="block text-sm">
              Room
              <select
                required
                aria-label="Block room"
                className="mt-1 block w-full rounded border border-line p-2"
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
              >
                <option value="">Choose room</option>
                {units
                  .filter((item) => item.status === 'active')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code}
                      {item.displayName ? ` · ${item.displayName}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              From
              <Input
                type="date"
                required
                value={dates.from}
                onChange={(event) => setDates({ ...dates, from: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              Until (exclusive)
              <Input
                type="date"
                required
                min={dates.from ? addDays(dates.from, 1) : undefined}
                value={dates.to}
                onChange={(event) => setDates({ ...dates, to: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              Reason
              <Input
                required
                maxLength={170}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <p className="text-sm text-ink-2">
              This removes {daysBetween(dates.from, dates.to) || 0} room nights from sale. Existing
              reservations must be moved before blocking.
            </p>
            {save.isError && (
              <p role="alert" className="text-sm text-closed-ink">
                {describeError(save.error, 'Block was not saved')}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                disabled={save.isPending || !unitId || !reason.trim() || dates.to <= dates.from}
              >
                {save.isPending ? 'Saving…' : `Confirm ${action.toLowerCase()}`}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAction('')}>
                Back
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
