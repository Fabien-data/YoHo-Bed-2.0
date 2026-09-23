'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, ClockCountdown, Lock, Plus, Wrench, X } from '@phosphor-icons/react';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  Field,
  InlineAlert,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import {
  createBlock,
  describeError,
  updateBlock,
  type BlockKind,
  type StayBar,
  type StayUnit,
} from '@/lib/api';
import { useRefreshDesk } from '@/components/booking/refresh';
import { useUxTask } from '@/lib/ux';
import { addDays, daysBetween, nightsLabel, shortDate, stayRange } from './model/dates';

/** The ways to use empty nights: sell them, hold them for a guest, or take them off sale. */
export type RangeAction = 'reserve' | 'hold' | 'blocked' | 'out_of_service';

export interface NightRange {
  unitId?: string;
  from: string;
  to: string;
}

/** The toolbar's + : every way to start something new, whether or not nights are selected. */
export function QuickActionsMenu({
  disabled,
  canReserve,
  canBlock,
  onAction,
  open,
  onOpenChange,
}: {
  disabled?: boolean;
  canReserve: boolean;
  canBlock: boolean;
  onAction: (action: RangeAction) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <Button size="sm" disabled={disabled} aria-label="Quick actions" title="Quick actions (+)">
          <Plus size={15} weight="bold" aria-hidden /> New
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        <MenuLabel>Sell or hold</MenuLabel>
        <MenuItem disabled={!canReserve} onSelect={() => onAction('reserve')}>
          <CalendarPlus size={15} aria-hidden /> New reservation
        </MenuItem>
        <MenuItem disabled={!canReserve} onSelect={() => onAction('hold')}>
          <ClockCountdown size={15} aria-hidden /> Courtesy hold
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Take off sale</MenuLabel>
        <MenuItem disabled={!canBlock} onSelect={() => onAction('blocked')}>
          <Lock size={15} aria-hidden /> Block dates
        </MenuItem>
        <MenuItem disabled={!canBlock} onSelect={() => onAction('out_of_service')}>
          <Wrench size={15} aria-hidden /> Out of service
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * Shown right under selected empty nights: what they are and what can be done with them. It
 * lives in the grid (marked `data-no-gesture` so a press on it is not a new selection).
 */
export function RangeActionBar({
  range,
  unit,
  canReserve,
  canBlock,
  onAction,
  onClear,
}: {
  range: NightRange;
  unit?: StayUnit;
  canReserve: boolean;
  canBlock: boolean;
  onAction: (action: RangeAction) => void;
  onClear: () => void;
}) {
  const nights = daysBetween(range.from, range.to);
  return (
    <div
      data-no-gesture
      role="toolbar"
      aria-label={`Selected: room ${unit?.code ?? ''}, ${stayRange(range.from, range.to)}`}
      className="sv-hovercard flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-overlay"
    >
      <span className="px-2 text-xs font-semibold text-ink">
        {unit ? `Room ${unit.code} · ` : ''}
        {shortDate(range.from)} · {nightsLabel(nights)}
      </span>
      {canReserve && (
        <>
          <Button size="sm" onClick={() => onAction('reserve')} data-autofocus>
            <CalendarPlus size={14} aria-hidden /> Reserve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('hold')}>
            <ClockCountdown size={14} aria-hidden /> Hold
          </Button>
        </>
      )}
      {canBlock && (
        <>
          <Button size="sm" variant="ghost" onClick={() => onAction('blocked')}>
            <Lock size={14} aria-hidden /> Block
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('out_of_service')}>
            <Wrench size={14} aria-hidden /> Out of service
          </Button>
        </>
      )}
      <Button size="icon" variant="ghost" aria-label="Clear selection" onClick={onClear}>
        <X size={14} aria-hidden />
      </Button>
    </div>
  );
}

export interface BlockDraft {
  /** Editing an existing block. */
  block?: StayBar;
  kind: BlockKind;
  unitId?: string;
  from: string;
  to: string;
}

const REASONS: Record<BlockKind, string[]> = {
  out_of_service: ['Plumbing repair', 'Air conditioning', 'Deep clean', 'Refurbishment'],
  blocked: ['Owner use', 'Staff accommodation', 'Event', 'Held for a VIP'],
};

/**
 * Take a room off sale — or change or lift a block. It says what happens to inventory and to
 * the channels before anything is saved, because both reach beyond this screen.
 */
export function BlockDialog({
  draft,
  units,
  propertyId,
  today,
  onClose,
  onSaved,
}: {
  draft: BlockDraft | null;
  units: StayUnit[];
  propertyId?: string;
  today: string;
  onClose: () => void;
  onSaved: (unitId: string, message: string) => void;
}) {
  const refresh = useRefreshDesk();
  const ux = useUxTask('stay.new_block', !!draft && !draft.block);
  const [kind, setKind] = React.useState<BlockKind>('out_of_service');
  const [unitId, setUnitId] = React.useState('');
  const [dates, setDates] = React.useState({ from: '', to: '' });
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (!draft) return;
    setKind(draft.kind);
    setUnitId(draft.unitId ?? '');
    setDates({ from: draft.from, to: draft.to });
    setReason(draft.block?.reason ?? '');
  }, [draft]);
  const unit = units.find((u) => u.id === unitId);
  const nights = dates.from && dates.to ? daysBetween(dates.from, dates.to) : 0;
  const save = useMutation({
    mutationFn: () =>
      draft?.block
        ? updateBlock(draft.block.id, {
            blockFrom: dates.from,
            blockTo: dates.to,
            reason: reason.trim(),
            kind,
          })
        : createBlock(propertyId!, {
            roomUnitId: unitId,
            blockFrom: dates.from,
            blockTo: dates.to,
            reason: reason.trim(),
            kind,
          }),
    onSuccess: () => {
      ux.complete();
      refresh();
      onSaved(
        unitId,
        draft?.block
          ? `Block on room ${unit?.code ?? ''} updated`
          : `Room ${unit?.code ?? ''} ${kind === 'blocked' ? 'blocked' : 'out of service'} ${stayRange(dates.from, dates.to)}`,
      );
    },
  });
  React.useEffect(() => save.reset(), [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = !!unitId && !!dates.from && dates.to > dates.from && reason.trim().length > 0;

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={draft?.block ? 'Edit block' : 'Take a room off sale'}
        className="max-w-lg"
      >
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (valid) save.mutate();
          }}
        >
          <SegmentedControl
            aria-label="Block type"
            value={kind}
            onChange={setKind}
            options={[
              {
                value: 'out_of_service',
                label: (
                  <>
                    <Wrench size={14} aria-hidden /> Out of service
                  </>
                ),
              },
              {
                value: 'blocked',
                label: (
                  <>
                    <Lock size={14} aria-hidden /> Blocked
                  </>
                ),
              },
            ]}
          />
          <p className="-mt-2 text-xs text-ink-3">
            {kind === 'out_of_service'
              ? 'Maintenance: the room cannot be used or sold.'
              : 'A sound room held back from sale — owner use, staff, an event.'}
          </p>
          <Field label="Room" required>
            <Select value={unitId} onValueChange={setUnitId} disabled={!!draft?.block}>
              <SelectTrigger aria-label="Room">
                <SelectValue placeholder="Choose a room" />
              </SelectTrigger>
              <SelectContent>
                {units
                  .filter((u) => u.status === 'active')
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.code}
                      {u.displayName ? ` · ${u.displayName}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <DatePicker
                value={dates.from}
                today={today}
                aria-label="Block from"
                onChange={(iso) =>
                  setDates((d) => ({ from: iso, to: d.to > iso ? d.to : addDays(iso, 1) }))
                }
              />
            </Field>
            <Field label="Until (the room is back that day)" required>
              <DatePicker
                value={dates.to}
                today={today}
                min={dates.from ? addDays(dates.from, 1) : undefined}
                rangeStart={dates.from}
                aria-label="Block until"
                onChange={(iso) => setDates((d) => ({ ...d, to: iso }))}
              />
            </Field>
          </div>
          <Field label="Reason" required>
            <Input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What guests and staff will see on the calendar"
            />
          </Field>
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {REASONS[kind].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                {r}
              </button>
            ))}
          </div>
          {nights > 0 && unit && (
            <InlineAlert tone="info">
              Room {unit.code} comes off sale for {nightsLabel(nights)} (
              {stayRange(dates.from, dates.to)}), here and on every connected channel. A guest
              already booked into it must be moved first.
            </InlineAlert>
          )}
          {save.isError && (
            <InlineAlert tone="error">
              {describeError(save.error, 'The block was not saved')}
            </InlineAlert>
          )}
          <div className="-mx-5 -mb-4 flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} loading={save.isPending}>
              {draft?.block
                ? 'Save block'
                : kind === 'blocked'
                  ? 'Block room'
                  : 'Take out of service'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Where to start a new block when none was selected: the first free room, tonight. */
export function defaultBlockDraft(kind: BlockKind, units: StayUnit[], from: string): BlockDraft {
  const free = units.find(
    (u) => u.status === 'active' && !u.bars.some((b) => b.from <= from && from < b.to),
  );
  return { kind, unitId: free?.id, from, to: addDays(from, 1) };
}

/** A toast that says what was done, and offers the way back when there is one. */
export function saved(message: string, undo?: () => void) {
  toast.success(message, undo ? { action: { label: 'Undo', onClick: undo } } : undefined);
}
