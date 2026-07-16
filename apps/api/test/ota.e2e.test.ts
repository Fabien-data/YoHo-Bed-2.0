import { afterAll, describe, expect, it } from 'vitest';
import { makeTenant, openAndPrice, request, stopApp, type TenantFixture } from './harness';

afterAll(stopApp);

const SECRET = 'test-cm-webhook-secret-000001';
let codeSeq = 0;

async function mapRoom(fx: TenantFixture): Promise<string> {
  codeSeq += 1;
  const code = `E2E-CM-${process.pid}-${Date.now().toString(36)}-${codeSeq}`;
  const res = await request('PUT', '/ota/mappings', {
    token: fx.token,
    body: { roomId: fx.roomId, code },
  });
  expect(res.status).toBe(200);
  return code;
}

function push(body: Record<string, unknown>, secret = SECRET) {
  return request('POST', '/cm/reservations', { body, headers: { 'x-cm-secret': secret } });
}

/** The inbound distribution path: a reservation must never be silently dropped. */
describe('OTA reservation inbox', () => {
  it('rejects a bad shared secret', async () => {
    const fx = await makeTenant();
    const code = await mapRoom(fx);
    const res = await push(
      {
        channel: 'booking.com',
        externalRef: 'BAD-SECRET-1',
        roomCode: code,
        guest: { name: 'Nobody' },
        checkin: '2028-01-02',
        checkout: '2028-01-03',
      },
      'wrong-secret',
    );
    expect(res.status).toBe(401);
  });

  it('422s an unmapped room code so the channel manager retries', async () => {
    const res = await push({
      channel: 'booking.com',
      externalRef: 'UNMAPPED-1',
      roomCode: 'NO-SUCH-CODE-XYZ',
      guest: { name: 'Nobody' },
      checkin: '2028-01-02',
      checkout: '2028-01-03',
    });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('unmapped_room_code');
  });

  it('imports a reservation as an auto-approved OTA booking and decrements inventory', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, '2028-02-01', '2028-02-10', { roomsToSell: 3 });
    const code = await mapRoom(fx);

    const res = await push({
      channel: 'booking.com',
      externalRef: `BDC-${Date.now()}`,
      roomCode: code,
      guest: { name: 'Nadeesha Silva', email: 'nadeesha@example.com' },
      checkin: '2028-02-02',
      checkout: '2028-02-04',
      rooms: 1,
      amount: 52000,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('imported');

    const bookings = await request('GET', '/bookings', { token: fx.token });
    const b = bookings.body.find((x: any) => x.reference === res.body.reference);
    expect(b.source).toBe('OTA');
    expect(b.status).toBe('Approved'); // the guest already paid the OTA

    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2028-02-02&to=2028-02-02`,
      {
        token: fx.token,
      },
    );
    expect(avail.body[0].roomsToSell).toBe(2);
  });

  it('is idempotent on (channel, externalRef)', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, '2028-03-01', '2028-03-10', { roomsToSell: 3 });
    const code = await mapRoom(fx);
    const payload = {
      channel: 'expedia',
      externalRef: `DUP-${Date.now()}`,
      roomCode: code,
      guest: { name: 'Double Push' },
      checkin: '2028-03-02',
      checkout: '2028-03-03',
    };

    const first = await push(payload);
    const second = await push(payload);
    expect(first.body.status).toBe('imported');
    expect(second.body.deduped).toBe(true);

    // Only one booking, and inventory moved exactly once.
    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2028-03-02&to=2028-03-02`,
      {
        token: fx.token,
      },
    );
    expect(avail.body[0].roomsToSell).toBe(2);
  });

  it('keeps a failed import visible and lets the owner retry once the cause is fixed', async () => {
    const fx = await makeTenant();
    const code = await mapRoom(fx); // no availability/prices yet → import must fail

    const res = await push({
      channel: 'agoda',
      externalRef: `FAIL-${Date.now()}`,
      roomCode: code,
      guest: { name: 'Too Early' },
      checkin: '2028-04-02',
      checkout: '2028-04-04',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');

    const inbox = await request('GET', '/ota/reservations', { token: fx.token });
    const row = inbox.body.find((r: any) => r.id === res.body.id);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy(); // the owner can see *why*

    await openAndPrice(fx, '2028-04-01', '2028-04-10');
    const retry = await request('POST', `/ota/reservations/${res.body.id}/retry`, {
      token: fx.token,
    });
    expect(retry.body.status).toBe('imported');
  });

  it('releases inventory when the channel manager cancels', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await openAndPrice(fx, '2028-05-01', '2028-05-10', { roomsToSell: 2 });
    const code = await mapRoom(fx);
    const ref = `CXL-${Date.now()}`;
    const base = {
      channel: 'booking.com',
      externalRef: ref,
      roomCode: code,
      checkin: '2028-05-02',
      checkout: '2028-05-03',
    };

    await push({ ...base, guest: { name: 'Will Cancel' } });
    const cancel = await push({ ...base, action: 'cancel' });
    expect(cancel.body.status).toBe('cancelled');

    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2028-05-02&to=2028-05-02`,
      {
        token: fx.token,
      },
    );
    expect(avail.body[0].roomsToSell).toBe(2);
  });
});
