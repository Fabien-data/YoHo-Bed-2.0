'use client';
import { Sheet, SheetContent } from '@yohobed/ui';
import { DAY_WINDOWS, type CalendarPreferences } from './calendar-model';

export function CalendarSettings({
  open,
  onClose,
  value,
  onChange,
  storageError,
}: {
  open: boolean;
  onClose: () => void;
  value: CalendarPreferences;
  onChange: (patch: Partial<CalendarPreferences>) => void;
  storageError: boolean;
}) {
  const toggle = (key: keyof CalendarPreferences, label: string) => (
    <label key={key} className="flex items-center justify-between gap-4 py-2 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(value[key])}
        onChange={(e) => onChange({ [key]: e.target.checked })}
      />
    </label>
  );
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        title="Calendar settings"
        description="Saved for your user and this property on this browser."
      >
        {storageError && (
          <p role="status" className="text-sm text-low-ink">
            Browser storage is unavailable. Preferences apply for this visit.
          </p>
        )}
        <fieldset className="mb-5">
          <legend className="font-semibold">Display</legend>
          {toggle('statistics', 'Daily statistics and availability')}
          {toggle('housekeeping', 'Housekeeping badges')}
          {toggle('metadata', 'Reservation details and indicators')}
          {toggle('sources', 'Booking sources')}
        </fieldset>
        <fieldset className="mb-5 space-y-3">
          <legend className="font-semibold">Appearance</legend>
          <label className="flex justify-between text-sm">
            Days in view
            <select
              aria-label="Default calendar days"
              value={value.days}
              onChange={(e) => onChange({ days: Number(e.target.value) })}
            >
              {DAY_WINDOWS.map((days) => (
                <option key={days}>{days}</option>
              ))}
            </select>
          </label>
          <label className="flex justify-between text-sm">
            Density
            <select
              aria-label="Calendar density"
              value={value.density}
              onChange={(e) =>
                onChange({ density: e.target.value as CalendarPreferences['density'] })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          {toggle('widePanel', 'Wider reservation panel')}
          {toggle('legend', 'Show calendar legend')}
        </fieldset>
        <fieldset>
          <legend className="font-semibold">Behavior</legend>
          {toggle('shortcuts', 'Calendar keyboard shortcuts')}
          {toggle('dragHints', 'Show drag guidance')}
          {toggle('snap', 'Show snapped date preview while dragging')}
          <p className="mt-2 text-xs text-ink-3">
            Stays always use whole nights. Availability validation and price reviews are always
            required.
          </p>
          <p className="mt-3 text-xs text-ink-2">
            Alt+F search · Alt+T today · Alt+← / → dates · Alt+Q quick actions · Alt+S settings ·
            Escape close. Focus a room row and use arrows, Shift+arrows and Enter to select nights.
          </p>
        </fieldset>
      </SheetContent>
    </Sheet>
  );
}
