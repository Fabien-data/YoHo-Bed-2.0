import { CmPushError, type CmAdapter, type CmPushInput, type CmPushResult } from './types';

/**
 * AxisRooms adapter — ports the legacy contract (extranet/app/Custom/Calasses/AxisRooms.php).
 *
 * The legacy integration does NOT speak OTA XML itself: it posts form-encoded "these
 * properties/rooms/dates changed, re-sync them" triggers to the in-house core service
 * (core.yohobed.com), which owns the actual AxisRooms conversation. We keep that contract exactly
 * — same endpoints, same field names, same PHP-style `key[]` array encoding — so this drops onto
 * the existing service with only credentials to configure.
 *
 * What we deliberately do NOT port:
 *  - Fire-and-forget. Legacy ignored the response entirely (BUG #3), so a channel that rejected an
 *    update failed silently. Here a non-2xx, a network error, or a timeout THROWS, which sends the
 *    event back through the outbox's retry/backoff and, eventually, the dead-letter + alert.
 *  - The dead `$channelId` variable (read from env, never sent). We keep `channelId` configurable
 *    and send it only when the endpoint is documented to take it — currently never, so it stays
 *    out of the payload rather than being cargo-culted in.
 *  - The per-call `PushingDataAxisroom` audit insert: the `outbox` table already records every
 *    event, its attempts and its last error, which is strictly more than the legacy log row.
 */

export interface AxisRoomsConfig {
  /** e.g. https://core.yohobed.com (legacy CM_URL_AXISROOMS). */
  baseUrl: string;
  /** Legacy AXISROOMS_CHANNEL_ID (164 in production). Retained for future endpoints. */
  channelId?: string;
  /** Optional bearer/api-key for the core service, if it requires one. */
  apiKey?: string;
  timeoutMs?: number;
  /** Endpoint paths — legacy CM_AXISROOMS_*_ENDPOINT env vars. */
  endpoints?: Partial<AxisRoomsEndpoints>;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface AxisRoomsEndpoints {
  inventory: string;
  rate: string;
  noShow: string;
  inventoryBlock: string;
  inventoryUnblock: string;
}

const DEFAULT_ENDPOINTS: AxisRoomsEndpoints = {
  inventory: '/api/axisrooms/inventory',
  rate: '/api/axisrooms/rate',
  noShow: '/api/axisrooms/no-show',
  inventoryBlock: '/api/axisrooms/inventory/block',
  inventoryUnblock: '/api/axisrooms/inventory/unblock',
};

/**
 * The fields our outbox payloads carry. `propertyId` is required for every ARI event: the core
 * service keys everything on the property.
 */
interface AriPayload {
  propertyId?: string;
  roomId?: string;
  occupancyId?: string;
  from?: string;
  to?: string;
  nights?: string[];
  action?: string;
  bookingId?: string;
  status?: string;
}

/** Every date in an inclusive range. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The dates an event touches. Legacy built this from dateFrom/dateTo; our events carry either a
 * range (`from`/`to`) or an explicit night list (reserve/release), so accept both.
 */
export function resolveDates(p: AriPayload): string[] {
  if (p.nights?.length) return [...p.nights];
  if (p.from && p.to) return datesInRange(p.from, p.to);
  if (p.from) return [p.from];
  return [];
}

/** PHP `form_params` with array values encode as `key[]=v1&key[]=v2` — match it exactly. */
function formEncode(fields: Record<string, string | string[] | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(v)}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

export class AxisRoomsAdapter implements CmAdapter {
  readonly provider = 'axisrooms';
  private readonly endpoints: AxisRoomsEndpoints;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AxisRoomsConfig) {
    if (!config.baseUrl) {
      throw new CmPushError('axisrooms', 'AxisRooms adapter requires a baseUrl');
    }
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async push(input: CmPushInput): Promise<CmPushResult> {
    const p = (input.payload ?? {}) as AriPayload;
    const { path, fields, summary } = this.mapEvent(input, p);
    await this.post(path, fields);
    return { ok: true, provider: this.provider, detail: summary };
  }

  /** Outbox event → (endpoint, legacy form fields). Exposed for contract tests. */
  mapEvent(
    input: CmPushInput,
    p: AriPayload,
  ): { path: string; fields: Record<string, string | string[] | undefined>; summary: string } {
    const dates = resolveDates(p);

    switch (input.eventType) {
      // Legacy send(): the core service re-pulls inventory for these properties/dates.
      case 'ari.availability': {
        if (p.action === 'block' || p.action === 'unblock') {
          this.require(p.propertyId, 'propertyId', input);
          this.require(p.roomId, 'roomId', input);
          const path =
            p.action === 'block' ? this.endpoints.inventoryBlock : this.endpoints.inventoryUnblock;
          return {
            path,
            // Legacy inventoryBlock/Unblock: propertyId, startDate, endDate, roomId.
            fields: {
              propertyId: p.propertyId,
              startDate: dates[0] ?? p.from,
              endDate: dates[dates.length - 1] ?? p.to ?? p.from,
              roomId: p.roomId,
            },
            summary: `${p.action} inventory room=${p.roomId} ${dates.length} date(s)`,
          };
        }
        this.require(p.propertyId, 'propertyId', input);
        return {
          path: this.endpoints.inventory,
          // Legacy send(): properties[] + dates[].
          fields: { properties: [p.propertyId!], dates },
          summary: `inventory sync property=${p.propertyId} ${dates.length} date(s)`,
        };
      }

      // Legacy sendPrice(): property + dates[] + roomId.
      case 'ari.rate': {
        this.require(p.propertyId, 'propertyId', input);
        this.require(p.roomId, 'roomId', input);
        return {
          path: this.endpoints.rate,
          fields: { property: p.propertyId, dates, roomId: p.roomId },
          summary: `rate sync room=${p.roomId} ${dates.length} date(s)`,
        };
      }

      /**
       * Restrictions had no legacy endpoint (the legacy PMS couldn't set min/max stay at all).
       * The core service re-pulls the whole ARI picture for a property+dates on the inventory
       * trigger, so route restrictions there rather than invent an endpoint that doesn't exist.
       */
      case 'ari.restriction': {
        this.require(p.propertyId, 'propertyId', input);
        return {
          path: this.endpoints.inventory,
          fields: { properties: [p.propertyId!], dates },
          summary: `restriction sync property=${p.propertyId} ${dates.length} date(s)`,
        };
      }

      // Legacy updateNoShow(): bookingId only.
      case 'booking.no_show': {
        this.require(p.bookingId ?? input.aggregateId, 'bookingId', input);
        return {
          path: this.endpoints.noShow,
          fields: { bookingId: p.bookingId ?? input.aggregateId },
          summary: `no-show booking=${p.bookingId ?? input.aggregateId}`,
        };
      }

      default:
        throw new CmPushError('axisrooms', `Unsupported event type '${input.eventType}'`);
    }
  }

  private require(value: unknown, field: string, input: CmPushInput): void {
    if (!value) {
      throw new CmPushError(
        'axisrooms',
        `Event ${input.eventType}:${input.aggregateId} is missing '${field}' — cannot map to the AxisRooms contract`,
      );
    }
  }

  private async post(
    path: string,
    fields: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: formEncode(fields),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Unlike legacy, a rejected update is a failure — the outbox retries, then alerts.
        const body = await res.text().catch(() => '');
        throw new CmPushError(
          'axisrooms',
          `${url} responded ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
        );
      }
    } catch (e) {
      if (e instanceof CmPushError) throw e;
      const reason =
        e instanceof Error && e.name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : String(e);
      throw new CmPushError('axisrooms', `${url} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
