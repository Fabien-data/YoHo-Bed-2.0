import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter, interval, map, merge, takeUntil, timer } from 'rxjs';
import { DatabaseService } from '../database/database.service';

/** One property's calendar changed (or: re-read everything, after a reconnect). */
export interface PropertyEvent {
  kind: 'change' | 'resync';
  tenantId: string | null;
  propertyId: string | null;
}

const CHANNEL = 'yhb_property';
/** Signals for one property inside this window are sent as one. */
const DEBOUNCE_MS = 250;
/** A stream ends after this long so the browser reconnects with a fresh token and fresh access. */
const STREAM_LIFETIME_MS = 15 * 60_000;

/**
 * Live calendars, driven by Postgres. Triggers on the tables the calendar draws signal
 * `yhb_property` when their transaction commits (migration 0042), so a change made by any
 * process — this API, another instance, the worker, a channel import — reaches every open
 * calendar of that property, and a rolled-back change reaches none.
 */
@Injectable()
export class PropertyEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PropertyEvents');
  private readonly events = new Subject<PropertyEvent>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private unlisten: (() => Promise<void>) | null = null;

  constructor(private readonly dbs: DatabaseService) {}

  async onModuleInit() {
    try {
      const listener = await this.dbs.listen(
        CHANNEL,
        (payload) => this.receive(payload),
        // Called on every (re)connect: anything missed while disconnected is re-read.
        () => this.events.next({ kind: 'resync', tenantId: null, propertyId: null }),
      );
      this.unlisten = listener.unlisten;
    } catch (error) {
      // Calendars still refresh by polling; live updates simply arrive later.
      this.log.warn(`Live calendar updates are off: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    await this.unlisten?.().catch(() => undefined);
    this.events.complete();
  }

  private receive(payload: string) {
    let parsed: { t?: string; p?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (!parsed.t || !parsed.p) return;
    const key = `${parsed.t}|${parsed.p}`;
    if (this.pending.has(key)) return;
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.events.next({ kind: 'change', tenantId: parsed.t!, propertyId: parsed.p! });
      }, DEBOUNCE_MS),
    );
  }

  /** Changes to one property of one tenant — never another tenant's — plus resyncs. */
  changes(tenantId: string, propertyId: string): Observable<PropertyEvent> {
    return this.events.pipe(
      filter(
        (e) => e.kind === 'resync' || (e.tenantId === tenantId && e.propertyId === propertyId),
      ),
    );
  }

  /** The SSE stream a calendar listens to: changes, a keep-alive ping, and a bounded lifetime. */
  stream(tenantId: string, propertyId: string): Observable<{ type: string; data: object }> {
    const ping = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    const hello = timer(0).pipe(map(() => ({ type: 'ready', data: { propertyId } })));
    const changes = this.changes(tenantId, propertyId).pipe(
      map((e) => ({
        type: e.kind === 'resync' ? 'resync' : 'change',
        data: { propertyId, at: new Date().toISOString() },
      })),
    );
    return merge(hello, changes, ping).pipe(takeUntil(timer(STREAM_LIFETIME_MS)));
  }
}
