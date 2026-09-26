'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  TimePicker,
  toast,
} from '@yohobed/ui';
import { updatePropertySettings, type PropertySettings } from '@/lib/api';
import { queryKeys, usePropertySettings } from '@/lib/queries';
import { SettingRow, errorMessage } from './shared';

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 text-right font-mono tabular-nums"
      />
      <span className="text-sm text-ink-3">{suffix}</span>
    </div>
  );
}

/**
 * How the reservation desk behaves at this property: formats, hold rules, the staff's price
 * authority, check-in and check-out, and how the day closes. The reservation types and the meal
 * plans have their own Configuration sections (2026-09-26); this form saves only its own fields,
 * so it can never overwrite theirs.
 */
export function ReservationSettingsForm({
  propertyId,
  canEdit,
}: {
  propertyId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const settings = usePropertySettings(propertyId);
  const [draft, setDraft] = React.useState<PropertySettings | null>(null);
  React.useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);

  const save = useMutation({
    mutationFn: (s: PropertySettings) =>
      updatePropertySettings(propertyId, {
        timeFormat: s.timeFormat,
        hold: s.hold,
        unconfirmedPolicy: s.unconfirmedPolicy,
        rateControl: s.rateControl,
        requireDocumentsAtCheckin: s.requireDocumentsAtCheckin,
        checkoutBalancePolicy: s.checkoutBalancePolicy,
        autoCheckout: s.autoCheckout,
        nightAudit: s.nightAudit,
      }),
    onSuccess: (saved) => {
      toast.success('Reservation settings saved');
      qc.setQueryData(queryKeys.propertySettings(propertyId), saved);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!draft) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card className="px-5 py-2">
          <SettingRow title="Time format" description="How times show on reservations and cards.">
            <SegmentedControl
              aria-label="Time format"
              value={draft.timeFormat}
              onChange={(v) => setDraft({ ...draft, timeFormat: v })}
              options={[
                { value: '12h', label: '02:00 PM' },
                { value: '24h', label: '14:00' },
              ]}
            />
          </SettingRow>
        </Card>

        <Card className="px-5 py-2">
          <SettingRow
            title="Default hold length"
            description="A hold keeps the rooms until its release time, then frees them automatically."
          >
            <NumberInput
              label="Default hold length in hours"
              value={draft.hold.defaultHours}
              min={1}
              max={1440}
              suffix="hours"
              onChange={(n) => setDraft({ ...draft, hold: { ...draft.hold, defaultHours: n } })}
            />
          </SettingRow>
          <SettingRow title="Remind before release" description="0 turns the reminder off.">
            <NumberInput
              label="Reminder hours before release"
              value={draft.hold.reminderHours}
              min={0}
              max={720}
              suffix="hours"
              onChange={(n) => setDraft({ ...draft, hold: { ...draft.hold, reminderHours: n } })}
            />
          </SettingRow>
          <SettingRow
            title="Unconfirmed bookings after the arrival date"
            description="Inquiries and unconfirmed holds with no release time."
          >
            <Select
              value={draft.unconfirmedPolicy}
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  unconfirmedPolicy: v as PropertySettings['unconfirmedPolicy'],
                })
              }
            >
              <SelectTrigger
                aria-label="Unconfirmed bookings after the arrival date"
                className="w-64"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Keep until staff act</SelectItem>
                <SelectItem value="arrival_day_end">
                  Cancel at the end of the arrival day
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </Card>

        <Card className="px-5 py-2">
          <SettingRow
            title="Staff discount limit"
            description="Front-desk staff may lower a nightly rate by up to this much. Beyond it, an owner approves on the spot."
          >
            <NumberInput
              label="Staff discount limit in percent"
              value={draft.rateControl.staffMaxDiscountPct}
              min={0}
              max={100}
              suffix="%"
              onChange={(n) =>
                setDraft({
                  ...draft,
                  rateControl: { ...draft.rateControl, staffMaxDiscountPct: n },
                })
              }
            />
          </SettingRow>
          <SettingRow
            title="Staff may give complimentary rooms"
            description="When off, a free room needs an owner's approval."
          >
            <Switch
              aria-label="Staff may give complimentary rooms"
              checked={draft.rateControl.staffCanComp}
              onCheckedChange={(v) =>
                setDraft({ ...draft, rateControl: { ...draft.rateControl, staffCanComp: v } })
              }
            />
          </SettingRow>
          <SettingRow
            title="Require an ID document before check-in"
            description="The guest's passport or national ID must be recorded first."
          >
            <Switch
              aria-label="Require an ID document before check-in"
              checked={draft.requireDocumentsAtCheckin}
              onCheckedChange={(v) => setDraft({ ...draft, requireDocumentsAtCheckin: v })}
            />
          </SettingRow>
          <SettingRow
            title="Settle the bill before check-out"
            description="A guest cannot be checked out with money still owing. The owner can still check out with a reason."
          >
            <Switch
              aria-label="Settle the bill before check-out"
              checked={draft.checkoutBalancePolicy === 'block'}
              onCheckedChange={(v) =>
                setDraft({ ...draft, checkoutBalancePolicy: v ? 'block' : 'allow' })
              }
            />
          </SettingRow>
        </Card>

        {/* Closing the day (owner brief, 2026-09-26): what the system does on its own overnight. */}
        <Card className="px-5 py-2">
          <SettingRow
            title="Check out overdue stays automatically"
            description="A guest still checked in after their departure day is checked out overnight and the room is marked for cleaning. Anything they owe stays on the bill, and the desk is told."
          >
            <Switch
              aria-label="Check out overdue stays automatically"
              checked={draft.autoCheckout}
              onCheckedChange={(v) => setDraft({ ...draft, autoCheckout: v })}
            />
          </SettingRow>
          <SettingRow
            title="Night audit"
            description={
              draft.nightAudit.mode === 'auto'
                ? `Runs by itself at this hotel time: it posts the night's charges, marks no-shows and moves the business date. ${draft.nightAudit.time < '12:00' ? 'A morning time closes the day before.' : 'An evening time closes the same day.'}`
                : 'Runs only when the owner presses Run on the Night audit page.'
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                aria-label="Night audit"
                value={draft.nightAudit.mode}
                onChange={(mode) =>
                  setDraft({ ...draft, nightAudit: { ...draft.nightAudit, mode } })
                }
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'manual', label: 'By hand' },
                ]}
              />
              {draft.nightAudit.mode === 'auto' && (
                <TimePicker
                  aria-label="Night audit time"
                  value={draft.nightAudit.time}
                  format={draft.timeFormat}
                  minuteStep={15}
                  disabled={!canEdit}
                  className="w-32"
                  onChange={(time) =>
                    setDraft({ ...draft, nightAudit: { ...draft.nightAudit, time } })
                  }
                />
              )}
            </div>
          </SettingRow>
        </Card>
      </fieldset>

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => settings.data && setDraft(settings.data)}
          >
            Discard changes
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}>
            Save settings
          </Button>
        </div>
      )}
    </div>
  );
}
