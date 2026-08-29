import { describe, it, expect } from 'vitest';
import {
  AxisRoomsAdapter,
  CmPushError,
  resolveAdapter,
  datesInRange,
  resolveDates,
} from '../src/index';

/**
 * Contract tests. There are no AxisRooms credentials yet, so these pin the wire format against
 * the legacy PHP client (extranet/app/Custom/Calasses/AxisRooms.php) using a stub fetch. When
 * credentials arrive, a green run here means only the base URL/endpoints need configuring.
 */

interface Captured {
  url: string;
  method: string;
  contentType: string;
  auth?: string;
  body: string;
  params: URLSearchParams;
}

function stubFetch(status = 200, body = 'OK') {
  const calls: Captured[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = String(init?.body ?? '');
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      contentType: headers['Content-Type'] ?? '',
      auth: headers['Authorization'],
      body: raw,
      params: new URLSearchParams(raw),
    });
    return new Response(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function adapter(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new AxisRoomsAdapter({
    baseUrl: 'https://core.yohobed.test/',
    channelId: '164',
    fetchImpl,
    ...extra,
  });
}

const PROPERTY = 'prop-1';
const ROOM = 'room-9';

describe('date helpers', () => {
  it('expands an inclusive range', () => {
    expect(datesInRange('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('handles a single-day range like the legacy begin==end branch', () => {
    expect(datesInRange('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });

  it('accepts an explicit night list (reserve/release events)', () => {
    expect(resolveDates({ nights: ['2026-08-02', '2026-08-03'] })).toEqual([
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(datesInRange('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });
});

describe('AxisRooms adapter — legacy wire contract', () => {
  it('posts inventory as properties[] + dates[], PHP form-encoded', async () => {
    const { impl, calls } = stubFetch();
    const res = await adapter(impl).push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.availability',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        from: '2026-08-01',
        to: '2026-08-03',
        action: 'open',
      },
    });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://core.yohobed.test/api/axisrooms/inventory');
    expect(c.contentType).toBe('application/x-www-form-urlencoded');
    // Legacy: form_params { properties: [...], dates: [...] } → PHP `key[]=` encoding.
    expect(c.params.getAll('properties[]')).toEqual([PROPERTY]);
    expect(c.params.getAll('dates[]')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('sends reserve/release night lists as inventory dates', async () => {
    const { impl, calls } = stubFetch();
    await adapter(impl).push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.availability',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        nights: ['2026-09-10', '2026-09-11'],
        action: 'reserve',
      },
    });
    expect(calls[0]!.params.getAll('dates[]')).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('posts rates as property + dates[] + roomId', async () => {
    const { impl, calls } = stubFetch();
    await adapter(impl).push({
      aggregate: 'rate',
      aggregateId: 'occ-1',
      eventType: 'ari.rate',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        occupancyId: 'occ-1',
        from: '2026-08-01',
        to: '2026-08-02',
        base: 18000,
      },
    });
    const c = calls[0]!;
    expect(c.url).toBe('https://core.yohobed.test/api/axisrooms/rate');
    // Legacy sendPrice used singular `property`, not `properties[]`.
    expect(c.params.get('property')).toBe(PROPERTY);
    expect(c.params.get('roomId')).toBe(ROOM);
    expect(c.params.getAll('dates[]')).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('routes block/unblock to their endpoints with startDate/endDate', async () => {
    const { impl, calls } = stubFetch();
    const a = adapter(impl);
    await a.push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.availability',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        from: '2026-08-01',
        to: '2026-08-05',
        action: 'block',
      },
    });
    await a.push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.availability',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        from: '2026-08-01',
        to: '2026-08-05',
        action: 'unblock',
      },
    });

    expect(calls[0]!.url).toBe('https://core.yohobed.test/api/axisrooms/inventory/block');
    expect(calls[1]!.url).toBe('https://core.yohobed.test/api/axisrooms/inventory/unblock');
    for (const c of calls) {
      expect(c.params.get('propertyId')).toBe(PROPERTY);
      expect(c.params.get('roomId')).toBe(ROOM);
      expect(c.params.get('startDate')).toBe('2026-08-01');
      expect(c.params.get('endDate')).toBe('2026-08-05');
    }
  });

  it('posts a no-show with just the booking id', async () => {
    const { impl, calls } = stubFetch();
    await adapter(impl).push({
      aggregate: 'booking',
      aggregateId: 'bk-77',
      eventType: 'booking.no_show',
      payload: { bookingId: 'bk-77' },
    });
    expect(calls[0]!.url).toBe('https://core.yohobed.test/api/axisrooms/no-show');
    expect(calls[0]!.params.get('bookingId')).toBe('bk-77');
  });

  it('routes restrictions to the inventory re-sync trigger (legacy had no such endpoint)', async () => {
    const { impl, calls } = stubFetch();
    await adapter(impl).push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.restriction',
      payload: {
        propertyId: PROPERTY,
        roomId: ROOM,
        from: '2026-08-01',
        to: '2026-08-02',
        minStay: 2,
        maxStay: 7,
      },
    });
    expect(calls[0]!.url).toBe('https://core.yohobed.test/api/axisrooms/inventory');
    expect(calls[0]!.params.getAll('dates[]')).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('honours configured endpoint overrides and an api key', async () => {
    const { impl, calls } = stubFetch();
    await adapter(impl, {
      endpoints: { inventory: '/legacy/inventory/push' },
      apiKey: 'secret-key',
    }).push({
      aggregate: 'availability',
      aggregateId: ROOM,
      eventType: 'ari.availability',
      payload: { propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-01' },
    });
    expect(calls[0]!.url).toBe('https://core.yohobed.test/legacy/inventory/push');
    expect(calls[0]!.auth).toBe('Bearer secret-key');
  });
});

/** The BUG #3 discipline: unlike legacy, a rejected or unreachable push must fail loudly. */
describe('AxisRooms adapter — failure is never silent', () => {
  it('throws on a non-2xx so the outbox retries', async () => {
    const { impl } = stubFetch(500, 'upstream exploded');
    await expect(
      adapter(impl).push({
        aggregate: 'availability',
        aggregateId: ROOM,
        eventType: 'ari.availability',
        payload: { propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-01' },
      }),
    ).rejects.toThrow(CmPushError);
  });

  it('throws on a network error', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      adapter(impl).push({
        aggregate: 'availability',
        aggregateId: ROOM,
        eventType: 'ari.availability',
        payload: { propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-01' },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('times out instead of hanging the worker', async () => {
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as unknown as typeof fetch;

    await expect(
      adapter(impl, { timeoutMs: 20 }).push({
        aggregate: 'availability',
        aggregateId: ROOM,
        eventType: 'ari.availability',
        payload: { propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-01' },
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('refuses an event it cannot map rather than posting a half-empty payload', async () => {
    const { impl, calls } = stubFetch();
    await expect(
      adapter(impl).push({
        aggregate: 'rate',
        aggregateId: 'occ-1',
        eventType: 'ari.rate',
        payload: { propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-01' }, // no roomId
      }),
    ).rejects.toThrow(/missing 'roomId'/);
    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown event type', async () => {
    const { impl } = stubFetch();
    await expect(
      adapter(impl).push({
        aggregate: 'weird',
        aggregateId: 'x',
        eventType: 'ari.unknown',
        payload: { propertyId: PROPERTY },
      }),
    ).rejects.toThrow(/Unsupported event type/);
  });
});

describe('adapter resolution', () => {
  it('defaults to the fake', () => {
    expect(resolveAdapter().provider).toBe('fake');
  });

  it('builds axisrooms when a base url is configured', () => {
    expect(
      resolveAdapter('axisrooms', { axisrooms: { baseUrl: 'https://core.yohobed.test' } }).provider,
    ).toBe('axisrooms');
  });

  /** Silently syncing nothing while claiming to be connected is the worst failure mode. */
  it('refuses to fall back to the fake when axisrooms is misconfigured', () => {
    expect(() => resolveAdapter('axisrooms')).toThrow(/requires CM_URL_AXISROOMS/);
  });

  /**
   * A typo'd provider must never select the fake: the fake marks every outbox row `sent`, so a
   * misspelt CM_PROVIDER would look perfectly healthy while syncing nothing to any channel.
   */
  it('throws on an unrecognised provider instead of falling back to the fake', () => {
    expect(() => resolveAdapter('axis-rooms')).toThrow(/Unknown CM_PROVIDER/);
    expect(() => resolveAdapter('')).toThrow(/Unknown CM_PROVIDER/);
  });

  it('forgives case and whitespace on a known provider', () => {
    expect(() => resolveAdapter('AxisRooms ')).toThrow(/requires CM_URL_AXISROOMS/);
    expect(resolveAdapter(' FAKE').provider).toBe('fake');
  });

  it('resolves rategain to the not-implemented placeholder that rejects on push', async () => {
    const adapter = resolveAdapter('rategain');
    expect(adapter.provider).toBe('rategain');
    await expect(
      adapter.push({ aggregate: 'room', aggregateId: 'x', eventType: 'rate.updated', payload: {} }),
    ).rejects.toThrow(/not implemented/);
  });
});
