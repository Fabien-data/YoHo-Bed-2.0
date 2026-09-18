'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RESERVATION_KINDS, RESERVATION_KIND_META } from '@yohobed/domain';
import {
  Badge,
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
  TagChip,
  TagColorPicker,
  toast,
} from '@yohobed/ui';
import { updatePropertySettings, type PropertySettings, type ReservationKind } from '@/lib/api';
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
 * authority and what each reservation type is called.
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
        ...s,
        // Empty labels mean "use the default name".
        kindOverrides: Object.fromEntries(
          Object.entries(s.kindOverrides).map(([k, o]) => [
            k,
            {
              ...(o?.label?.trim() && { label: o.label.trim() }),
              ...(o?.color && { color: o.color }),
            },
          ]),
        ),
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

  const setKind = (kind: ReservationKind, patch: { label?: string; color?: string }) =>
    setDraft({
      ...draft,
      kindOverrides: {
        ...draft.kindOverrides,
        [kind]: { ...draft.kindOverrides[kind], ...patch },
      },
    });

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
          <SettingRow
            title="Meal-plan codes"
            description="Indian hotels and OTAs read EP / CP / MAP / AP for the same plans."
          >
            <SegmentedControl
              aria-label="Meal-plan codes"
              value={draft.mealCodeStyle}
              onChange={(v) => setDraft({ ...draft, mealCodeStyle: v })}
              options={[
                { value: 'international', label: 'RO · BB · HB · FB' },
                { value: 'indian', label: 'EP · CP · MAP · AP' },
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
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Reservation types</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink-3">
            Rename or recolour the five types. What each one does to room inventory is fixed.
          </p>
          <div className="flex flex-col divide-y divide-line">
            {RESERVATION_KINDS.map((kind) => {
              const meta = RESERVATION_KIND_META[kind];
              const override = draft.kindOverrides[kind] ?? {};
              const color = override.color ?? meta.color;
              return (
                <div
                  key={kind}
                  className="grid gap-3 py-3 lg:grid-cols-[13rem_minmax(0,16rem)_minmax(0,1fr)] lg:items-center"
                >
                  <div className="flex min-w-0 flex-col items-start gap-1.5">
                    <TagChip color={color}>{override.label?.trim() || meta.label}</TagChip>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.holdsInventory ? (
                        <Badge tone="brand">Takes rooms</Badge>
                      ) : (
                        <Badge tone="muted">Does not take rooms</Badge>
                      )}
                      {meta.isHold && <Badge tone="low">Released on time</Badge>}
                    </div>
                  </div>
                  <Input
                    aria-label={`${meta.label} label`}
                    placeholder={meta.label}
                    value={override.label ?? ''}
                    maxLength={40}
                    onChange={(e) => setKind(kind, { label: e.target.value })}
                  />
                  <TagColorPicker
                    label={`${meta.label} colour`}
                    value={color}
                    disabled={!canEdit}
                    onChange={(c) => setKind(kind, { color: c })}
                    className="lg:justify-end"
                  />
                </div>
              );
            })}
          </div>
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
