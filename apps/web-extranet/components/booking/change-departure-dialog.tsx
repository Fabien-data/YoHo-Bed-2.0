'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { DatePicker, Field, toast } from '@yohobed/ui';
import { addDaysIso } from '@yohobed/locale';
import { changeDeparture, describeError } from '@/lib/api';
import { ReasonDialog } from './reason-dialog';
import { useRefreshDesk } from './refresh';

/**
 * "Can I stay two more nights?" / "We're leaving tomorrow instead" (UX-1b). Only the nights added or
 * removed change — nights already slept keep their price — and the guest keeps their room, or is
 * told which room and date stand in the way (docs/UX-STANDARD.md §3, ≤ 4C + 1T).
 */
export function ChangeDepartureDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: { id: string; reference: string; checkin: string; checkout: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDesk();
  const [checkout, setCheckout] = React.useState('');
  React.useEffect(() => {
    if (open && booking) setCheckout(addDaysIso(booking.checkout, 1));
  }, [open, booking]);

  const save = useMutation({
    mutationFn: (reason: string) => changeDeparture(booking!.id, checkout, reason),
    onSuccess: (b) => {
      refresh();
      toast.success(
        `${b.reference} now leaves on ${b.checkout} — ${b.nights} night${b.nights === 1 ? '' : 's'}`,
      );
      onOpenChange(false);
    },
  });

  if (!booking) return null;
  const nightsDelta = checkout
    ? Math.round(
        (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${booking.checkout}T00:00:00Z`)) /
          86_400_000,
      )
    : 0;

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change ${booking.reference}'s departure`}
      consequence={
        nightsDelta > 0 ? (
          <>
            {nightsDelta} more night{nightsDelta === 1 ? '' : 's'}, priced at today&apos;s rate for
            this stay. The guest keeps their room.
          </>
        ) : nightsDelta < 0 ? (
          <>
            {-nightsDelta} night{nightsDelta === -1 ? '' : 's'} fewer. They go back on sale and off
            the bill.
          </>
        ) : (
          <>Choose the new departure date.</>
        )
      }
      confirmLabel="Change departure"
      suggestions={['Guest asked to extend', 'Guest leaving early', 'Change of plans']}
      busy={save.isPending}
      error={save.isError ? describeError(save.error) : null}
      onConfirm={(reason) => {
        if (checkout && checkout !== booking.checkout) save.mutate(reason);
      }}
    >
      <Field label="New departure" htmlFor="new-departure">
        <DatePicker
          id="new-departure"
          aria-label="New departure"
          value={checkout}
          onChange={setCheckout}
          today={booking.checkout}
          min={addDaysIso(booking.checkin, 1)}
          rangeStart={booking.checkin}
          rangeEnd={checkout}
        />
      </Field>
    </ReasonDialog>
  );
}
