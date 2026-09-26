'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RESERVATION_KINDS, RESERVATION_KIND_META } from '@yohobed/domain';
import { Badge, Button, Card, Input, Skeleton, TagChip, TagColorPicker, toast } from '@yohobed/ui';
import { updatePropertySettings, type PropertySettings, type ReservationKind } from '@/lib/api';
import { queryKeys, usePropertySettings } from '@/lib/queries';
import { errorMessage } from './shared';

type Overrides = PropertySettings['kindOverrides'];

/**
 * Yanolja's Reservation Type (Configuration → Reservation types): rename or recolour the five
 * types. What each does to room inventory is fixed in code — a hotel-editable "takes rooms"
 * switch would be an overbooking switch — so it is shown here, not offered.
 */
export function ReservationTypesEditor({
  propertyId,
  canEdit,
}: {
  propertyId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const settings = usePropertySettings(propertyId);
  const [draft, setDraft] = React.useState<Overrides | null>(null);
  React.useEffect(() => {
    if (settings.data) setDraft(settings.data.kindOverrides);
  }, [settings.data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data?.kindOverrides);

  const save = useMutation({
    mutationFn: (overrides: Overrides) =>
      updatePropertySettings(propertyId, {
        // Empty labels mean "use the default name".
        kindOverrides: Object.fromEntries(
          Object.entries(overrides).map(([k, o]) => [
            k,
            {
              ...(o?.label?.trim() && { label: o.label.trim() }),
              ...(o?.color && { color: o.color }),
            },
          ]),
        ),
      }),
    onSuccess: (saved) => {
      toast.success('Reservation types saved');
      qc.setQueryData(queryKeys.propertySettings(propertyId), saved);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!draft) return <Skeleton className="h-80 w-full" />;

  const setKind = (kind: ReservationKind, patch: { label?: string; color?: string }) =>
    setDraft({ ...draft, [kind]: { ...draft[kind], ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <fieldset disabled={!canEdit} className="flex flex-col divide-y divide-line">
          {RESERVATION_KINDS.map((kind) => {
            const meta = RESERVATION_KIND_META[kind];
            const override = draft[kind] ?? {};
            const color = override.color ?? meta.color;
            return (
              <div
                key={kind}
                className="grid gap-3 py-3 first:pt-0 last:pb-0 lg:grid-cols-[14rem_minmax(0,16rem)_minmax(0,1fr)] lg:items-center"
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
                    {meta.initialStatus === 'Pending' && <Badge tone="info">Unconfirmed</Badge>}
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
        </fieldset>
      </Card>
      <p className="text-xs text-ink-3">
        An online failed booking keeps the guest&apos;s room until you confirm or cancel it; an
        inquiry never takes one.
      </p>
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => settings.data && setDraft(settings.data.kindOverrides)}
          >
            Discard changes
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
