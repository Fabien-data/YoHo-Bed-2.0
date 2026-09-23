'use client';

import * as React from 'react';
import {
  Broom,
  CalendarPlus,
  ClockCountdown,
  DoorOpen,
  Eye,
  Lock,
  PencilSimple,
  Sparkle,
  SquaresFour,
  Wrench,
} from '@phosphor-icons/react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@yohobed/ui';
import type { StayBar, StayUnit } from '@/lib/api';
import { ACTION_LABEL, type StayAction } from './model/actions';
import { shortDate } from './model/dates';

/** What was right-clicked. */
export type MenuTarget =
  | { kind: 'bar'; bar: StayBar; actions: StayAction[] }
  | { kind: 'unit'; unit: StayUnit }
  | { kind: 'night'; unit: StayUnit; date: string };

/**
 * The calendar's right-click menu: the common jobs for a stay, a room or an empty night. It is a
 * shortcut only — everything here is also in the side panel, the + menu or the action bar.
 */
export function CalendarContextMenu({
  target,
  canReserve,
  canBlock,
  canHousekeeping,
  onOpenBar,
  onAction,
  onEditBlock,
  onOpenUnit,
  onHousekeeping,
  onNight,
  onRoomView,
}: {
  target: MenuTarget | null;
  canReserve: boolean;
  canBlock: boolean;
  canHousekeeping: boolean;
  onOpenBar: (bar: StayBar) => void;
  onAction: (action: StayAction, bar: StayBar) => void;
  onEditBlock: (bar: StayBar) => void;
  onOpenUnit: (unit: StayUnit) => void;
  onHousekeeping: (unit: StayUnit, status: 'clean' | 'dirty') => void;
  onNight: (
    action: 'reserve' | 'hold' | 'blocked' | 'out_of_service',
    unit: StayUnit,
    date: string,
  ) => void;
  onRoomView: () => void;
}) {
  if (!target) return <ContextMenuContent className="hidden" />;
  if (target.kind === 'bar') {
    const { bar } = target;
    return (
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>{bar.kind === 'block' ? bar.reason : bar.guestName}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpenBar(bar)}>
          <Eye size={15} aria-hidden /> Open
        </ContextMenuItem>
        {bar.kind === 'block' ? (
          canBlock && (
            <ContextMenuItem onSelect={() => onEditBlock(bar)}>
              <PencilSimple size={15} aria-hidden /> Edit block
            </ContextMenuItem>
          )
        ) : (
          <>
            {target.actions.length > 0 && <ContextMenuSeparator />}
            {target.actions.map((a) => (
              <ContextMenuItem
                key={a}
                destructive={a === 'cancel' || a === 'no-show' || a === 'release'}
                onSelect={() => onAction(a, bar)}
              >
                {ACTION_LABEL[a]}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    );
  }
  if (target.kind === 'unit') {
    const { unit } = target;
    return (
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Room {unit.code}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpenUnit(unit)}>
          <DoorOpen size={15} aria-hidden /> Room details
        </ContextMenuItem>
        {canHousekeeping && (
          <>
            <ContextMenuItem
              disabled={unit.housekeeping === 'clean'}
              onSelect={() => onHousekeeping(unit, 'clean')}
            >
              <Sparkle size={15} aria-hidden /> Mark clean
            </ContextMenuItem>
            <ContextMenuItem
              disabled={unit.housekeeping === 'dirty'}
              onSelect={() => onHousekeeping(unit, 'dirty')}
            >
              <Broom size={15} aria-hidden /> Mark dirty
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRoomView}>
          <SquaresFour size={15} aria-hidden /> Open Room View
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }
  const { unit, date } = target;
  return (
    <ContextMenuContent className="w-60">
      <ContextMenuLabel>
        Room {unit.code} · {shortDate(date)}
      </ContextMenuLabel>
      <ContextMenuItem disabled={!canReserve} onSelect={() => onNight('reserve', unit, date)}>
        <CalendarPlus size={15} aria-hidden /> New reservation
      </ContextMenuItem>
      <ContextMenuItem disabled={!canReserve} onSelect={() => onNight('hold', unit, date)}>
        <ClockCountdown size={15} aria-hidden /> Courtesy hold
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canBlock} onSelect={() => onNight('blocked', unit, date)}>
        <Lock size={15} aria-hidden /> Block dates
      </ContextMenuItem>
      <ContextMenuItem disabled={!canBlock} onSelect={() => onNight('out_of_service', unit, date)}>
        <Wrench size={15} aria-hidden /> Out of service
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
