'use client';

import * as React from 'react';
import { postUxEvents, type UxEvent } from './api';

/**
 * UX measurement in the browser (UX-0) — how long the core tasks take and what they cost in
 * clicks, so docs/UX-STANDARD.md's budgets are checked against real hotel days, not just tests.
 *
 * What leaves the browser: a task key, a duration, a click count, how many fields were typed
 * into, the route PATTERN and the app version. Never a name, reference, amount or anything typed.
 */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

/**
 * The task catalogue. A key names a job the desk does, so one key's numbers mean the same thing
 * wherever the job is started from. Add new keys here; the API accepts any well-formed key.
 */
export type UxTask =
  | 'reservation.quick'
  | 'reservation.full'
  | 'stay.check_in'
  | 'stay.check_out'
  | 'folio.take_payment'
  | 'search.find_booking'
  | 'night_audit.run';

const queue: UxEvent[] = [];
let flushTimer: number | null = null;

function flush(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (queue.length) postUxEvents(queue.splice(0, 50));
}

/** `/app/invoices/5f0c…` → `/app/invoices/[id]`: the route, never the record. */
export function routePattern(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\d+/g, '[n]');
}

export function track(event: Omit<UxEvent, 'appVersion'>): void {
  if (typeof window === 'undefined') return;
  queue.push({
    ...event,
    route: event.route ?? routePattern(window.location.pathname),
    appVersion: APP_VERSION,
  });
  if (queue.length >= 50) flush();
  else if (flushTimer === null) flushTimer = window.setTimeout(flush, 10_000);
}

// ---- Interaction counting ------------------------------------------------------------------

/**
 * What counts as a click (the "C" in the UX budgets): a press on something interactive, or a key
 * that commits — Enter, or a shortcut such as Alt+N. Typing into a field is counted separately,
 * once per field, as the "T".
 */
const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="option"], ' +
  '[role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], ' +
  '[role="combobox"], [role="gridcell"], [data-ux-click]';

let clickCount = 0;
let listening = false;

function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) clickCount++;
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || ((e.altKey || e.ctrlKey || e.metaKey) && e.key.length === 1))
        clickCount++;
    },
    true,
  );
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export interface TaskHandle {
  complete(): void;
  abandon(): void;
}

/**
 * Start timing a task. Exactly one of `complete()` / `abandon()` records it; later calls are
 * ignored, so a handle can safely be ended from both a success path and a cleanup.
 */
export function startTask(task: UxTask, opts: { openedByClick?: boolean } = {}): TaskHandle {
  if (typeof window === 'undefined') return { complete() {}, abandon() {} };
  listen();
  const t0 = performance.now();
  // The press that opened a sheet lands just before the sheet mounts: it is part of the task.
  const c0 = clickCount - (opts.openedByClick ? 1 : 0);
  const fields = new Set<EventTarget>();
  const onInput = (e: Event) => {
    if (e.target) fields.add(e.target);
  };
  document.addEventListener('input', onInput, true);
  let ended = false;
  const end = (outcome: 'completed' | 'abandoned') => {
    if (ended) return;
    ended = true;
    document.removeEventListener('input', onInput, true);
    track({
      kind: 'task',
      task,
      outcome,
      durationMs: Math.round(performance.now() - t0),
      clicks: clickCount - c0,
      fields: fields.size,
    });
  };
  return { complete: () => end('completed'), abandon: () => end('abandoned') };
}

/**
 * A task that runs while `active` is true (a sheet or dialog is open). Closing it without calling
 * `complete()` records an abandon. The click that opened it is part of the task.
 */
export function useUxTask(task: UxTask, active: boolean): { complete: () => void } {
  const handle = React.useRef<TaskHandle | null>(null);
  React.useEffect(() => {
    if (!active) return;
    const h = startTask(task, { openedByClick: true });
    handle.current = h;
    return () => {
      h.abandon();
      handle.current = null;
    };
  }, [task, active]);
  return React.useMemo(() => ({ complete: () => handle.current?.complete() }), []);
}

/** A render crash the user saw. Only its kind and route are sent, never the message. */
export function reportClientError(): void {
  track({ kind: 'client_error' });
  flush();
}
