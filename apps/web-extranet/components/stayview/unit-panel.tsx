'use client';
import { useMutation } from '@tanstack/react-query';
import { Button, Sheet, SheetContent } from '@yohobed/ui';
import { setHousekeeping, describeError, type StayUnit, type StayBar } from '@/lib/api';
import { HK_LABEL } from './calendar-model';
import { useCalendarAccess } from './use-calendar-preferences';

export function UnitPanel({
  unit,
  category,
  propertyId,
  today,
  onClose,
  onChanged,
  onSelect,
  onBlock,
}: {
  unit: StayUnit | null;
  category?: string;
  propertyId?: string;
  today: string;
  onClose: () => void;
  onChanged: (message: string) => void;
  onSelect: (bar: StayBar) => void;
  onBlock: (unitId: string) => void;
}) {
  const { can } = useCalendarAccess();
  const save = useMutation({
    mutationFn: (status: StayUnit['housekeeping']) =>
      setHousekeeping(propertyId!, { roomUnitId: unit!.id, date: today, status }),
    onSuccess: (_, status) =>
      onChanged(`Room ${unit?.code} marked ${HK_LABEL[status].toLowerCase()}.`),
  });
  return (
    <Sheet modal={false} open={!!unit} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showOverlay={false}
        onInteractOutside={(event) => event.preventDefault()}
        title={
          unit ? `${unit.code}${unit.displayName ? ` · ${unit.displayName}` : ''}` : 'Room details'
        }
        description={category}
      >
        {unit && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <p>
                Floor
                <br />
                <strong>{unit.floor ?? 'Not assigned'}</strong>
              </p>
              <p>
                Housekeeping
                <br />
                <strong>{HK_LABEL[unit.housekeeping]}</strong>
              </p>
              <p>
                Room status
                <br />
                <strong>{unit.status === 'active' ? 'Active' : 'Out of service'}</strong>
              </p>
              <p>
                Accessibility
                <br />
                <strong>{unit.wheelchairAccessible ? 'Wheelchair accessible' : 'Standard'}</strong>
              </p>
            </div>
            {unit.smokingPolicy && <p>Smoking: {unit.smokingPolicy.replaceAll('_', ' ')}</p>}
            {unit.notes && <p className="rounded-lg bg-surface-2 p-3">{unit.notes}</p>}
            {unit.housekeepingNotes && <p>Housekeeping note: {unit.housekeepingNotes}</p>}
            <p className="text-xs text-ink-3">Updates apply to today at the property ({today}).</p>
            <div className="flex flex-wrap gap-2">
              {(['clean', 'dirty', 'inspected'] as const).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant="secondary"
                  disabled={!can('housekeeping') || save.isPending}
                  onClick={() => save.mutate(status)}
                >
                  Mark {HK_LABEL[status].toLowerCase()}
                </Button>
              ))}
            </div>
            {save.isPending && <p role="status">Saving housekeeping…</p>}
            {save.isError && (
              <p role="alert" className="text-closed-ink">
                {describeError(save.error, 'Housekeeping was not saved. Try again when connected')}
              </p>
            )}
            <Button
              variant="secondary"
              disabled={!can('reservation_change')}
              onClick={() => onBlock(unit.id)}
            >
              Block / maintenance
            </Button>
            <h3 className="font-semibold">Stays in this window</h3>
            {unit.bars
              .filter((bar) => bar.kind === 'booking')
              .map((bar) => (
                <button
                  key={bar.id}
                  className="block w-full rounded-lg border border-line p-3 text-left hover:bg-surface-2"
                  onClick={() => onSelect(bar)}
                >
                  <strong>{bar.guestName}</strong>
                  <span className="block text-xs text-ink-3">
                    {bar.from} → {bar.to} · {bar.reference}
                  </span>
                </button>
              ))}
            {!unit.bars.some((bar) => bar.kind === 'booking') && (
              <p className="text-ink-3">No stays in this date window.</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
