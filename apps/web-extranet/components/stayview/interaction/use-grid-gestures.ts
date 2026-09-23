'use client';

import * as React from 'react';
import type { StayBar, StayUnit } from '@/lib/api';
import { addDays } from '../model/dates';
import { dayAt } from '../model/layout';
import { capabilities, destinationIssue } from '../model/validity';
import type { InteractionStore, RangeSelection } from './store';

/**
 * One pointer arbiter for the whole grid. A press on a bar, its departure handle or an empty
 * night becomes, after a few pixels of movement, a room move, a date move, a resize or a range
 * selection — or, if the pointer never moved, a click. The pointer is captured on the scroll
 * viewport, so a drag keeps working across rows, lanes and auto-scrolling, and the target is
 * found by position, never by which element happens to be under a captured pointer.
 */

export interface GridModel {
  windowFrom: string;
  days: number;
  colW: number;
  /** The hotel's today and the date the desk works to. */
  today: string;
  operatingDate: string;
  barsById: Map<string, StayBar>;
  unitsById: Map<string, StayUnit>;
  canAssign: boolean;
  canChangeDates: boolean;
  canCreate: boolean;
}

export interface GestureHandlers {
  onOpenBar: (bar: StayBar) => void;
  onHoverBar?: (bar: StayBar | null) => void;
  onRange: (range: RangeSelection) => void;
  onOpenEmpty: (unitId: string, date: string) => void;
  onProposeMove: (bar: StayBar, toUnitId: string) => void;
  onProposeDates: (bar: StayBar, from: string, to: string) => void;
  onProposeResize: (bar: StayBar, to: string) => void;
  onRefuse: (bar: StayBar, message: string) => void;
}

interface Press {
  kind: 'bar' | 'resize' | 'range';
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  scrollLeft0: number;
  scrollTop0: number;
  bar?: StayBar;
  unitId?: string;
  day0?: number;
  started: boolean;
  baseIssue: string | null;
  axis: 'x' | 'y' | null;
}

const THRESHOLD = 4;
const EDGE = 40;
const MAX_SPEED = 18;

/** The room row (or room label) under a point, found by position. */
function unitAtPoint(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const host = (el as HTMLElement).closest?.<HTMLElement>('[data-unit-id],[data-unit-label]');
    if (host) return host.dataset.unitId ?? host.dataset.unitLabel ?? null;
    if ((el as HTMLElement).dataset?.lane) return null;
  }
  return null;
}

function stripOf(root: HTMLElement, unitId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(unitId)}"]`);
}

export function useGridGestures(
  viewport: React.RefObject<HTMLDivElement>,
  store: InteractionStore,
  model: GridModel,
  handlers: GestureHandlers,
  opts: { headerHeight: number; labelWidth: number },
) {
  const modelRef = React.useRef(model);
  modelRef.current = model;
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const press = React.useRef<Press | null>(null);
  const pointer = React.useRef({ x: 0, y: 0 });
  const frame = React.useRef<number | null>(null);
  const dropEl = React.useRef<HTMLElement | null>(null);
  const hoverTimer = React.useRef<number | null>(null);
  const hoverId = React.useRef<string | null>(null);

  const markDrop = React.useCallback((el: HTMLElement | null, state: 'ok' | 'no' | null) => {
    if (dropEl.current && dropEl.current !== el) delete dropEl.current.dataset.drop;
    dropEl.current = el;
    if (el) {
      if (state) el.dataset.drop = state;
      else delete el.dataset.drop;
    }
  }, []);

  const markSource = React.useCallback(
    (barId: string | null) => {
      const root = viewport.current;
      if (!root) return;
      root.querySelectorAll<HTMLElement>('[data-drag-source]').forEach((el) => {
        delete el.dataset.dragSource;
      });
      if (barId)
        root
          .querySelectorAll<HTMLElement>(`[data-bar-id="${CSS.escape(barId)}"]`)
          .forEach((el) => (el.dataset.dragSource = 'true'));
    },
    [viewport],
  );

  /** Recompute where the current gesture points, from the last pointer position. */
  const update = React.useCallback(() => {
    const p = press.current;
    const root = viewport.current;
    if (!p || !p.started || !root) return;
    const m = modelRef.current;
    const { x, y } = pointer.current;
    const dx = x - p.x0 + (root.scrollLeft - p.scrollLeft0);

    if (p.kind === 'range') {
      const strip = stripOf(root, p.unitId!);
      if (!strip) return;
      const end = dayAt(x - strip.getBoundingClientRect().left, m.colW, m.days);
      store.set({ range: { unitId: p.unitId!, start: p.day0!, end, done: false } });
      return;
    }

    const bar = p.bar!;
    const origin = bar.roomUnitId ? (m.unitsById.get(bar.roomUnitId) ?? null) : null;
    if (p.kind === 'resize') {
      const nights = Math.round(dx / m.colW);
      let to = addDays(bar.to, nights);
      if (to <= bar.from) to = addDays(bar.from, 1);
      const floor = bar.status === 'CheckedIn' ? m.operatingDate : m.today;
      const issue =
        p.baseIssue ??
        (to < floor && to !== bar.to
          ? 'The guest cannot leave before today. To let them go now, check them out.'
          : origin && to > bar.to
            ? destinationIssue(bar, origin, { from: bar.to, to })
            : null);
      store.set({
        drag: {
          bar,
          mode: 'resize',
          axis: 'x',
          originUnitId: origin?.id ?? null,
          unitId: origin?.id ?? null,
          from: bar.from,
          to,
          issue,
        },
      });
      return;
    }

    if (p.axis === 'x') {
      const shift = Math.round(dx / m.colW);
      const from = addDays(bar.from, shift);
      const to = addDays(bar.to, shift);
      const issue =
        p.baseIssue ??
        (shift !== 0 && from < m.today
          ? 'A stay cannot be moved to start in the past.'
          : origin && shift !== 0
            ? destinationIssue(bar, origin, { from, to })
            : null);
      store.set({
        drag: {
          bar,
          mode: 'move',
          axis: 'x',
          originUnitId: origin?.id ?? null,
          unitId: origin?.id ?? null,
          from,
          to,
          issue,
        },
      });
      markDrop(null, null);
      return;
    }

    // Vertical: another room, same dates.
    const unitId = unitAtPoint(x, y);
    const target = unitId ? (m.unitsById.get(unitId) ?? null) : null;
    const same = !!target && target.id === origin?.id;
    const issue =
      p.baseIssue ??
      (target && !same ? destinationIssue(bar, target, { today: m.operatingDate }) : null);
    const strip = target ? stripOf(root, target.id) : null;
    markDrop(strip, target && !same ? (issue ? 'no' : 'ok') : null);
    store.set({
      drag: {
        bar,
        mode: 'move',
        axis: 'y',
        originUnitId: origin?.id ?? null,
        unitId: target?.id ?? null,
        from: bar.from,
        to: bar.to,
        issue: target && !same ? issue : p.baseIssue,
      },
    });
  }, [viewport, store, markDrop]);

  /** Scroll when the pointer rests near an edge, then re-aim. Runs only while a gesture is live. */
  const tick = React.useCallback(() => {
    frame.current = null;
    const p = press.current;
    const root = viewport.current;
    if (!p?.started || !root) return;
    const rect = root.getBoundingClientRect();
    const { x, y } = pointer.current;
    const { headerHeight, labelWidth } = optsRef.current;
    const speed = (d: number) => Math.ceil(MAX_SPEED * Math.min(1, Math.max(0, (EDGE - d) / EDGE)));
    let sx = 0;
    let sy = 0;
    if (x > rect.right - EDGE) sx = speed(rect.right - x);
    else if (x < rect.left + labelWidth + EDGE) sx = -speed(x - rect.left - labelWidth);
    if (p.kind !== 'range') {
      if (y > rect.bottom - EDGE) sy = speed(rect.bottom - y);
      else if (y < rect.top + headerHeight + EDGE) sy = -speed(y - rect.top - headerHeight);
    }
    if (sx || sy) root.scrollBy(sx, sy);
    update();
    frame.current = requestAnimationFrame(tick);
  }, [viewport, update]);

  const finish = React.useCallback(
    (cancelled: boolean) => {
      const p = press.current;
      press.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      markDrop(null, null);
      markSource(null);
      if (!p) return;
      const h = handlersRef.current;
      const state = store.get();

      if (p.kind === 'range') {
        const range = state.range;
        if (cancelled || !range) store.set({ range: null });
        else {
          const done = { ...range, done: true };
          store.set({ range: done });
          h.onRange(done);
        }
        return;
      }
      const drag = state.drag;
      store.set({ drag: null });
      if (cancelled) return;
      if (!p.started) {
        if (p.kind === 'bar') h.onOpenBar(p.bar!);
        return;
      }
      if (!drag) return;
      const bar = p.bar!;
      if (drag.issue) {
        const moved =
          drag.mode === 'resize'
            ? drag.to !== bar.to
            : drag.axis === 'x'
              ? drag.from !== bar.from
              : !!drag.unitId && drag.unitId !== drag.originUnitId;
        if (moved) h.onRefuse(bar, drag.issue);
        return;
      }
      if (drag.mode === 'resize') {
        if (drag.to !== bar.to) h.onProposeResize(bar, drag.to);
      } else if (drag.axis === 'x') {
        if (drag.from !== bar.from) h.onProposeDates(bar, drag.from, drag.to);
      } else if (drag.unitId && drag.unitId !== drag.originUnitId) {
        h.onProposeMove(bar, drag.unitId);
      }
    },
    [store, markDrop, markSource],
  );

  const clearHover = React.useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (hoverId.current !== null) {
      hoverId.current = null;
      store.set({ hover: null });
    }
  }, [store]);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || press.current) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-unit-label],[data-no-gesture]')) return;
      const root = viewport.current;
      if (!root) return;
      const m = modelRef.current;
      const barEl = target.closest<HTMLElement>('[data-bar-id]');
      const resizeEl = target.closest<HTMLElement>('[data-resize]');
      const base = {
        pointerId: e.pointerId,
        touch: e.pointerType === 'touch',
        x0: e.clientX,
        y0: e.clientY,
        scrollLeft0: root.scrollLeft,
        scrollTop0: root.scrollTop,
        started: false,
        axis: null,
      } as const;
      clearHover();
      if (barEl) {
        const bar = m.barsById.get(barEl.dataset.barId!);
        if (!bar) return;
        const caps = capabilities(bar, {
          today: m.operatingDate,
          canAssign: m.canAssign,
          canChangeDates: m.canChangeDates,
        });
        press.current = {
          ...base,
          kind: resizeEl ? 'resize' : 'bar',
          bar,
          baseIssue:
            resizeEl && !caps.resize
              ? (caps.why ?? 'This stay’s departure cannot change here.')
              : null,
        };
        if (resizeEl) e.preventDefault();
      } else {
        const strip = target.closest<HTMLElement>('[data-unit-id]');
        if (!strip || !m.canCreate) return;
        const unit = m.unitsById.get(strip.dataset.unitId!);
        if (!unit || unit.status !== 'active') return;
        const day0 = dayAt(e.clientX - strip.getBoundingClientRect().left, m.colW, m.days);
        press.current = {
          ...base,
          kind: 'range',
          unitId: unit.id,
          day0,
          started: true,
          baseIssue: null,
        };
        store.set({ range: { unitId: unit.id, start: day0, end: day0, done: false } });
        e.preventDefault();
      }
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* A synthetic event may not be capturable; the gesture still works without capture. */
      }
    },
    [viewport, store, clearHover],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const p = press.current;
      if (!p) {
        // Hover preview: after a short pause over a bar, never while dragging.
        const barEl = (e.target as HTMLElement).closest<HTMLElement>('[data-bar-id]');
        const id = barEl?.dataset.barId ?? null;
        if (id === hoverId.current) return;
        clearHover();
        if (!id || e.pointerType === 'touch') return;
        hoverId.current = id;
        hoverTimer.current = window.setTimeout(() => {
          const bar = modelRef.current.barsById.get(id);
          if (!bar || !barEl?.isConnected || press.current) return;
          const r = barEl.getBoundingClientRect();
          store.set({
            hover: { bar, rect: { left: r.left, top: r.top, width: r.width, height: r.height } },
          });
        }, 160);
        return;
      }
      if (p.pointerId !== e.pointerId) return;
      if (!p.started) {
        const dx = e.clientX - p.x0;
        const dy = e.clientY - p.y0;
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        // Touch scrolls the grid; moving a stay by touch goes through the panel instead.
        if (p.touch) {
          press.current = null;
          return;
        }
        const m = modelRef.current;
        const bar = p.bar!;
        const caps = capabilities(bar, {
          today: m.operatingDate,
          canAssign: m.canAssign,
          canChangeDates: m.canChangeDates,
        });
        if (p.kind === 'bar') {
          p.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          if (p.axis === 'x' && !caps.shiftDates)
            p.baseIssue =
              caps.why ??
              (bar.status === 'CheckedIn'
                ? 'An in-house stay keeps its arrival. Drag the right edge to change the departure.'
                : (bar.segment?.of ?? 1) > 1
                  ? 'This stay is split across rooms. Change its dates from the reservation.'
                  : 'This stay’s dates cannot move here.');
          if (p.axis === 'y' && !caps.moveRoom)
            p.baseIssue = caps.why ?? 'This stay cannot change rooms.';
        }
        p.started = true;
        markSource(bar.id);
        if (frame.current === null) frame.current = requestAnimationFrame(tick);
      }
      update();
    },
    [store, clearHover, update, tick, markSource],
  );

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (press.current && press.current.pointerId === e.pointerId) finish(false);
    },
    [finish],
  );
  const onPointerCancel = React.useCallback(() => finish(true), [finish]);

  const onDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const m = modelRef.current;
      if (!m.canCreate) return;
      const unitId = unitAtPoint(e.clientX, e.clientY);
      const root = viewport.current;
      if (!unitId || !root) return;
      if (
        (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).some(
          (el) => el.dataset?.barId,
        )
      )
        return;
      const strip = stripOf(root, unitId);
      if (!strip) return;
      const day = dayAt(e.clientX - strip.getBoundingClientRect().left, m.colW, m.days);
      const date = addDays(m.windowFrom, day);
      const unit = m.unitsById.get(unitId);
      if (!unit || unit.bars.some((b) => b.from <= date && date < b.to)) return;
      store.set({ range: null });
      handlersRef.current.onOpenEmpty(unitId, date);
    },
    [viewport, store],
  );

  const onPointerLeave = React.useCallback(() => {
    if (!press.current) clearHover();
  }, [clearHover]);

  // Escape abandons a gesture in progress.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current) {
        e.stopPropagation();
        finish(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [finish]);

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onPointerLeave,
    onLostPointerCapture: onPointerCancel,
  };
}
