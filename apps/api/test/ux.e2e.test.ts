import { describe, it, expect, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { memberships, systemHeartbeats, users, uxEvents } from '@yohobed/db';
import {
  PASSWORD,
  addDeskUser,
  admin,
  login,
  makeStaff,
  makeTenant,
  request,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * UX Excellence Program, UX-0: the measurement behind docs/UX-STANDARD.md (task timings, the
 * pulse survey, the staff scoreboard) and the hygiene that came with it (request references and a
 * /health that actually checks something).
 */

afterAll(stopApp);

async function housekeeper(fx: TenantFixture) {
  const email = `hk-${crypto.randomUUID()}@test.yohobed.local`;
  const [user] = await admin()
    .insert(users)
    .values({
      tenantId: fx.tenantId,
      email,
      name: 'E2E Housekeeper',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    })
    .returning();
  await admin()
    .insert(memberships)
    .values({ userId: user!.id, tenantId: fx.tenantId, role: 'HOUSEKEEPING_ATTENDANT' });
  return { userId: user!.id, token: await login(email) };
}

/** Pretend the person joined the hotel `days` ago. */
async function backdateMembership(userId: string, tenantId: string, days: number) {
  await admin()
    .update(memberships)
    .set({ createdAt: new Date(Date.now() - days * 86_400_000) })
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
}

describe('UX events', () => {
  it('stores task timings against the caller, never what the body claims', async () => {
    const fx = await makeTenant();
    const other = await makeTenant();
    const res = await request('POST', '/ux/events', {
      token: fx.token,
      body: {
        events: [
          {
            kind: 'task',
            task: 'reservation.quick',
            outcome: 'completed',
            durationMs: 41_250,
            clicks: 7,
            fields: 2,
            route: `/app/invoices/5f0c6f43-2b8e-4a55-9a1d-0e6f3b2c7d11?ref=260922001`,
            appVersion: 'abc1234',
            // A client may send extra keys — they are dropped, never stored.
            tenantId: other.tenantId,
            guestName: 'Must Not Be Stored',
          },
        ],
      },
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1 });

    const rows = await admin().select().from(uxEvents).where(eq(uxEvents.tenantId, fx.tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: fx.userId,
      role: 'OWNER',
      kind: 'task',
      task: 'reservation.quick',
      outcome: 'completed',
      durationMs: 41_250,
      clicks: 7,
      fields: 2,
      appVersion: 'abc1234',
    });
    // The record's id and the query string never reach the database.
    expect(rows[0]!.route).toBe('/app/invoices/[id]');
    const leaked = await admin()
      .select()
      .from(uxEvents)
      .where(eq(uxEvents.tenantId, other.tenantId));
    expect(leaked).toHaveLength(0);
  });

  it('refuses free text where a task key belongs', async () => {
    const fx = await makeTenant();
    const res = await request('POST', '/ux/events', {
      token: fx.token,
      body: { events: [{ kind: 'task', task: 'Checked in Mr Perera', outcome: 'completed' }] },
    });
    expect(res.status).toBe(400);
  });

  it('lets housekeeping take part too', async () => {
    const fx = await makeTenant();
    const hk = await housekeeper(fx);
    const events = await request('POST', '/ux/events', {
      token: hk.token,
      body: { events: [{ kind: 'survey_shown' }] },
    });
    expect(events.status).toBe(202);
    const survey = await request('GET', '/ux/survey', { token: hk.token });
    expect(survey.status).toBe(200);
  });

  it('needs a signed-in hotel user', async () => {
    const res = await request('POST', '/ux/events', { body: { events: [{ kind: 'task' }] } });
    expect(res.status).toBe(401);
  });
});

describe('pulse survey', () => {
  it('waits two weeks, then asks once a quarter', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);

    const fresh = await request('GET', '/ux/survey', { token: desk.token });
    expect(fresh.status).toBe(200);
    expect(fresh.body.eligible).toBe(false);
    expect(fresh.body.items.map((i: { key: string }) => i.key)).toEqual([
      'easy_to_use',
      'easy_to_learn',
      'faster',
      'fewer_mistakes',
    ]);

    await backdateMembership(desk.userId, fx.tenantId, 20);
    expect((await request('GET', '/ux/survey', { token: desk.token })).body.eligible).toBe(true);

    const answer = await request('POST', '/ux/survey', {
      token: desk.token,
      body: {
        answers: { easy_to_use: 5, easy_to_learn: 4, faster: 4, fewer_mistakes: 3 },
        comment: 'Check-out takes too many steps',
      },
    });
    expect(answer.status).toBe(201);
    expect((await request('GET', '/ux/survey', { token: desk.token })).body.eligible).toBe(false);
  });

  it('respects "Not now" for two weeks', async () => {
    const fx = await makeTenant();
    await backdateMembership(fx.userId, fx.tenantId, 30);
    expect((await request('GET', '/ux/survey', { token: fx.token })).body.eligible).toBe(true);
    await request('POST', '/ux/events', {
      token: fx.token,
      body: { events: [{ kind: 'survey_dismissed' }] },
    });
    expect((await request('GET', '/ux/survey', { token: fx.token })).body.eligible).toBe(false);
  });

  it('wants every statement answered, on the 1–5 scale', async () => {
    const fx = await makeTenant();
    const partial = await request('POST', '/ux/survey', {
      token: fx.token,
      body: { answers: { easy_to_use: 5 } },
    });
    expect(partial.status).toBe(400);
    const outOfRange = await request('POST', '/ux/survey', {
      token: fx.token,
      body: { answers: { easy_to_use: 9, easy_to_learn: 4, faster: 4, fewer_mistakes: 4 } },
    });
    expect(outOfRange.status).toBe(400);
  });
});

describe('staff UX scoreboard', () => {
  it('is for YoHo staff only', async () => {
    const fx = await makeTenant();
    const res = await request('GET', '/staff/ux/scoreboard', { token: fx.token });
    expect(res.status).toBe(403);
  });

  it('reports task medians, survey agreement against the baseline, and quick take-backs', async () => {
    const fx = await makeTenant();
    await request('POST', '/ux/events', {
      token: fx.token,
      body: {
        events: [10_000, 20_000, 30_000].map((durationMs, i) => ({
          kind: 'task',
          task: 'reservation.quick',
          outcome: 'completed',
          durationMs,
          clicks: 6 + i,
        })),
      },
    });
    await request('POST', '/ux/events', {
      token: fx.token,
      body: { events: [{ kind: 'task', task: 'reservation.quick', outcome: 'abandoned' }] },
    });
    await request('POST', '/ux/survey', {
      token: fx.token,
      body: { answers: { easy_to_use: 5, easy_to_learn: 2, faster: 4, fewer_mistakes: 4 } },
    });

    const staff = await makeStaff();
    const res = await request('GET', `/staff/ux/scoreboard?days=7&tenantId=${fx.tenantId}`, {
      token: staff.token,
    });
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([
      {
        task: 'reservation.quick',
        completed: 3,
        abandoned: 1,
        medianMs: 20_000,
        p90Ms: 28_000,
        medianClicks: 7,
      },
    ]);
    const learn = res.body.survey.find((s: { key: string }) => s.key === 'easy_to_learn');
    expect(learn).toMatchObject({ responses: 1, agreePct: 0, baselinePct: 69.4 });
    const use = res.body.survey.find((s: { key: string }) => s.key === 'easy_to_use');
    expect(use).toMatchObject({ responses: 1, agreePct: 100 });
    expect(res.body.mistakes).toEqual({ quickVoids: 0, quickCancels: 0, quickCreditNotes: 0 });
  });
});

describe('request references', () => {
  it('stamps every response with a reference, keeping a well-formed one from the caller', async () => {
    const res = await request('GET', '/health');
    expect(res.headers['x-request-id']).toMatch(/^R-[A-Za-z0-9_-]{8}$/);

    const kept = await request('GET', '/health', { headers: { 'X-Request-Id': 'nginx-abc123' } });
    expect(kept.headers['x-request-id']).toBe('nginx-abc123');

    const junk = await request('GET', '/health', {
      headers: { 'X-Request-Id': 'bad id with spaces' },
    });
    expect(junk.headers['x-request-id']).toMatch(/^R-/);
  });
});

describe('health', () => {
  it('reports a missing worker without failing the lenient check deploys rely on', async () => {
    await admin().delete(systemHeartbeats).where(eq(systemHeartbeats.name, 'worker'));
    const lenient = await request('GET', '/health');
    expect(lenient.status).toBe(200);
    expect(lenient.body.checks).toMatchObject({ database: 'ok', worker: 'down' });
    expect(lenient.body.status).toBe('degraded');

    const strict = await request('GET', '/health?strict=1');
    expect(strict.status).toBe(503);
  });

  it('is healthy with a fresh worker beat and a clear outbox, and flags dead letters', async () => {
    const beat = (info: Record<string, unknown>, at = new Date()) =>
      admin()
        .insert(systemHeartbeats)
        .values({ name: 'worker', beatAt: at, info })
        .onConflictDoUpdate({ target: systemHeartbeats.name, set: { beatAt: at, info } });

    await beat({ outbox: { pending: 0, oldestPendingSeconds: 0, failed: 0 } });
    const ok = await request('GET', '/health?strict=1');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'ok', checks: { worker: 'ok', outbox: 'ok' } });

    await beat({ outbox: { pending: 2, oldestPendingSeconds: 5, failed: 1 } });
    const deadLetters = await request('GET', '/health?strict=1');
    expect(deadLetters.status).toBe(503);
    expect(deadLetters.body.checks.outbox).toBe('degraded');

    await beat(
      { outbox: { pending: 0, oldestPendingSeconds: 0, failed: 0 } },
      new Date(Date.now() - 10 * 60_000),
    );
    const stale = await request('GET', '/health');
    expect(stale.status).toBe(200);
    expect(stale.body.checks.worker).toBe('degraded');

    await admin().delete(systemHeartbeats).where(eq(systemHeartbeats.name, 'worker'));
  });
});
