import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { dayCloseDueProperties } from '@yohobed/db';
import {
  addUnits,
  admin,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  payInFull,
  request,
  startApp,
  stopApp,
  type TenantFixture,
} from './harness';
import { DayCloseService } from '../src/automation/day-close.service';

/**
 * The day closing by itself (owner brief, 2026-09-26): a stay nobody checked out is checked out
 * once its departure day is over — its room turns dirty — and the night audit runs at the hotel
 * time the owner set, catching a lagging business date up.
 *
 * The suites share one database and run side by side, so these tests drive the scheduler for
 * their own property only (`closeProperty` and friends), never the global pass.
 */
afterAll(stopApp);

const dayClose = async () => (await startApp()).get(DayCloseService);

const act = (fx: TenantFixture, id: string, what: string, body?: unknown) =>
  request('POST', `/bookings/${id}/${what}`, { token: fx.token, body });

const bookingOf = async (fx: TenantFixture, id: string) =>
  (await request('GET', `/bookings/${id}`, { token: fx.token })).body;

/**
 * A guest checked in, whose stay has since ended without anyone checking them out: booked and
 * checked in on today's dates, then moved `daysAgo` into the past (as postgres, like any fixture).
 * `checkedInAgoMinutes` backdates the check-in past the scheduler's recording grace.
 */
async function overdueStay(
  fx: TenantFixture,
  opts: { nights?: number; endedDaysAgo?: number; checkedInAgoMinutes?: number } = {},
) {
  const nights = opts.nights ?? 2;
  const ended = opts.endedDaysAgo ?? 1;
  const b = await book(fx, { checkin: hotelToday(), checkout: hotelToday(nights) });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  await act(fx, b.body.id, 'approve');
  const inn = await act(fx, b.body.id, 'check-in');
  expect(inn.status, JSON.stringify(inn.body)).toBe(200);

  const checkin = hotelToday(-(ended + nights));
  const checkout = hotelToday(-ended);
  const minutes = opts.checkedInAgoMinutes ?? 120;
  await admin().execute(sql`
    update bookings
       set checkin = ${checkin}::date, checkout = ${checkout}::date,
           checked_in_at = now() - make_interval(mins => ${minutes})
     where id = ${b.body.id}`);
  await admin().execute(sql`
    update booking_rooms set checkin = ${checkin}::date, checkout = ${checkout}::date
     where booking_id = ${b.body.id}`);
  return b.body as { id: string; reference: string; amount: string };
}

async function housekeepingOn(unitId: string, date: string) {
  const rows = (await admin().execute(sql`
    select status from housekeeping_status where room_unit_id = ${unitId} and date = ${date}::date
  `)) as unknown as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}

describe('automatic check-out', () => {
  it('checks out a stay left in house after its departure day, and dirties its room', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const [unit] = await addUnits(fx, fx.roomId, ['101']);
    const stay = await overdueStay(fx);

    // The property is due: a stay is in house after its departure day.
    const due = await dayCloseDueProperties(admin());
    expect(due).toContainEqual({
      tenantId: fx.tenantId,
      propertyId: fx.propertyId,
      reason: 'checkout',
    });

    const done = await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId);
    expect(done).toHaveLength(1);
    expect(done[0]!.reference).toBe(stay.reference);
    // Nothing was paid, so the guest still owes the stay — it stays on the bill.
    expect(done[0]!.owed).toMatch(/^LKR \d+\.\d{2}$/);

    const b = await bookingOf(fx, stay.id);
    expect(b.status).toBe('CheckedOut');
    expect(b.checkedOutAt).toBeTruthy();

    // The room reads dirty from today, with a departure clean waiting.
    expect(await housekeepingOn(unit!, hotelToday())).toBe('dirty');
    const tasks = (await admin().execute(sql`
      select kind, booking_id as "bookingId" from housekeeping_tasks where room_unit_id = ${unit}
    `)) as unknown as Array<{ kind: string; bookingId: string }>;
    expect(tasks).toContainEqual({ kind: 'departure', bookingId: stay.id });

    // On the record: the system did it, and why.
    const trail = (await admin().execute(sql`
      select action, reason, actor_user_id as "actor" from booking_approvals
       where booking_id = ${stay.id} and action = 'checked_out'
    `)) as unknown as Array<{ action: string; reason: string; actor: string | null }>;
    expect(trail).toHaveLength(1);
    expect(trail[0]!.reason).toMatch(/automatically/i);
    expect(trail[0]!.actor).toBeNull();

    // The desk is told, with what is still to pay.
    const notes = (await admin().execute(sql`
      select title, body from notifications
       where tenant_id = ${fx.tenantId} and type = 'auto_checkout' and entity_id = ${stay.id}
    `)) as unknown as Array<{ title: string; body: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toMatch(/still to pay/);

    // Nothing left to do on the next pass.
    expect(await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId)).toHaveLength(0);
  });

  it('says nothing is owed when the stay was paid', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const stay = await overdueStay(fx);
    await payInFull(fx, stay.id);
    const [done] = await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId);
    expect(done).toMatchObject({ reference: stay.reference, owed: null });
  });

  it('leaves alone a past stay the desk checked in moments ago (recording it after the fact)', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const stay = await overdueStay(fx, { checkedInAgoMinutes: 1 });
    expect(await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId)).toHaveLength(0);
    expect((await bookingOf(fx, stay.id)).status).toBe('CheckedIn');
  });

  it('does nothing when the owner switched automatic check-out off', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const off = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { autoCheckout: false },
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.autoCheckout).toBe(false);
    const stay = await overdueStay(fx);

    const due = await dayCloseDueProperties(admin());
    expect(
      due.some((d) => d.propertyId === fx.propertyId && d.reason === 'checkout'),
      'not due for its overstay once switched off',
    ).toBe(false);
    expect(await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId)).toHaveLength(0);
    expect((await bookingOf(fx, stay.id)).status).toBe('CheckedIn');
  });

  it('does not dirty a room that was cleaned after the guest was due to leave', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const [unit] = await addUnits(fx, fx.roomId, ['201']);
    const stay = await overdueStay(fx, { endedDaysAgo: 3 });
    // Housekeeping turned the room over the day after the guest left; nobody told the desk.
    await admin().execute(sql`
      insert into housekeeping_status (tenant_id, property_id, room_unit_id, date, status)
      values (${fx.tenantId}, ${fx.propertyId}, ${unit}, ${hotelToday(-2)}::date, 'clean')
      on conflict (room_unit_id, date) do update set status = 'clean'`);

    const [done] = await (await dayClose()).checkOutOverdue(fx.tenantId, fx.propertyId);
    expect(done?.reference).toBe(stay.reference);
    expect((await bookingOf(fx, stay.id)).status).toBe('CheckedOut');
    expect(await housekeepingOn(unit!, hotelToday())).toBeNull();
  });

  it('checks out the overstays of the day the night audit closes', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const stay = await overdueStay(fx, { checkedInAgoMinutes: 1 });

    const preview = await request('GET', `/properties/${fx.propertyId}/night-audit/preview`, {
      token: fx.token,
    });
    expect(preview.body.autoCheckout).toBe(true);
    expect(preview.body.overstays.map((o: { id: string }) => o.id)).toContain(stay.id);

    const run = await request('POST', `/properties/${fx.propertyId}/night-audit/run`, {
      token: fx.token,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.summary.checkedOutAutomatically).toEqual([stay.reference]);
    expect(run.body.summary.overstays).toEqual([]);
    expect(run.body.trigger).toBe('manual');
    expect((await bookingOf(fx, stay.id)).status).toBe('CheckedOut');
  });

  it('leaves overstays in house through the audit when automatic check-out is off', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { autoCheckout: false },
    });
    const stay = await overdueStay(fx);
    const run = await request('POST', `/properties/${fx.propertyId}/night-audit/run`, {
      token: fx.token,
    });
    expect(run.body.summary.checkedOutAutomatically).toEqual([]);
    expect(run.body.summary.overstays).toEqual([stay.reference]);
    expect((await bookingOf(fx, stay.id)).status).toBe('CheckedIn');
  });
});

describe('automatic night audit', () => {
  /** Put the property's business date `days` behind today (as if nobody ran the audit). */
  async function lagBy(fx: TenantFixture, days: number) {
    await request('GET', `/properties/${fx.propertyId}/business-date`, { token: fx.token });
    await admin().execute(sql`
      update business_dates set "current_date" = ${hotelToday(-days)}::date
       where property_id = ${fx.propertyId}`);
  }
  /** Noon today on the hotel's clock: yesterday's 02:00 audit is due, today's is not. */
  const noonToday = () => new Date(`${hotelToday()}T12:00:00+05:30`);

  it('closes each missed day at its time, as an automatic run with no user', async () => {
    const fx = await makeTenant();
    await lagBy(fx, 3);

    const closed = await (await dayClose()).runDueAudits(fx.tenantId, fx.propertyId, noonToday());
    expect(closed).toEqual([hotelToday(-3), hotelToday(-2), hotelToday(-1)]);

    const bd = await request('GET', `/properties/${fx.propertyId}/business-date`, {
      token: fx.token,
    });
    expect(bd.body.currentDate).toBe(hotelToday());
    const log = await request('GET', `/properties/${fx.propertyId}/night-audit/log`, {
      token: fx.token,
    });
    expect(log.body).toHaveLength(3);
    for (const entry of log.body) {
      expect(entry.trigger).toBe('auto');
      expect(entry.runBy).toBeNull();
      expect(entry.runFromIp).toBeNull();
    }

    // Caught up: nothing more is due until tonight's time.
    expect(await (await dayClose()).runDueAudits(fx.tenantId, fx.propertyId, noonToday())).toEqual(
      [],
    );
  });

  it('closes the day the same evening for an evening time', async () => {
    const fx = await makeTenant();
    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { nightAudit: { time: '23:30' } },
    });
    await lagBy(fx, 0);
    const service = await dayClose();
    // 23:00: not yet. 23:45: today closes.
    const at = (hhmm: string) => new Date(`${hotelToday()}T${hhmm}:00+05:30`);
    expect(await service.runDueAudits(fx.tenantId, fx.propertyId, at('23:00'))).toEqual([]);
    expect(await service.runDueAudits(fx.tenantId, fx.propertyId, at('23:45'))).toEqual([
      hotelToday(),
    ]);
  });

  it('never runs while the owner keeps the audit manual', async () => {
    const fx = await makeTenant();
    const res = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { nightAudit: { mode: 'manual' } },
    });
    expect(res.body.nightAudit).toEqual({ mode: 'manual', time: '02:00' });
    await lagBy(fx, 2);
    expect(await (await dayClose()).runDueAudits(fx.tenantId, fx.propertyId, noonToday())).toEqual(
      [],
    );
  });

  it('never runs on a plan without night audit', async () => {
    const fx = await makeTenant({ plan: 'starter' });
    await admin().execute(sql`
      insert into business_dates (tenant_id, property_id, "current_date")
      values (${fx.tenantId}, ${fx.propertyId}, ${hotelToday(-2)}::date)`);
    expect(await (await dayClose()).runDueAudits(fx.tenantId, fx.propertyId, noonToday())).toEqual(
      [],
    );
  });

  it('checks overdue stays out first, then closes the day', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const stay = await overdueStay(fx);
    await lagBy(fx, 1);
    const result = await (await dayClose()).closeProperty(fx.tenantId, fx.propertyId, noonToday());
    expect(result.error).toBeUndefined();
    expect(result.checkedOut.map((c) => c.reference)).toEqual([stay.reference]);
    expect(result.audits).toEqual([hotelToday(-1)]);
  });

  it('rejects a malformed audit time', async () => {
    const fx = await makeTenant();
    const res = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { nightAudit: { time: '25:00' } },
    });
    expect(res.status).toBe(400);
  });
});
