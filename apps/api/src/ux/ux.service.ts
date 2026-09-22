import { Injectable } from '@nestjs/common';
import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import { memberships, tenants, uxEvents, uxSurveyResponses } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { UxEventsDto, UxSurveyDto, ScoreboardQueryDto } from './dto';
import {
  SURVEY_INTERVAL_DAYS,
  SURVEY_ITEMS,
  SURVEY_MIN_TENURE_DAYS,
  SURVEY_SNOOZE_DAYS,
} from './survey';

const DAY_MS = 86_400_000;

export interface Caller {
  tenantId: string;
  userId: string;
  role: string | undefined;
}

/**
 * UX measurement (UX-0): the numbers behind docs/UX-STANDARD.md — task time and clicks, mistake
 * signals, and the pulse survey scored against the industry baseline.
 *
 * The tables carry no RLS (like audit_log), so every read here filters by tenant explicitly and
 * the tenant always comes from the guard, never from the request body.
 */
@Injectable()
export class UxService {
  constructor(private readonly dbs: DatabaseService) {}

  async record(caller: Caller, dto: UxEventsDto): Promise<{ accepted: number }> {
    await this.dbs.db.insert(uxEvents).values(
      dto.events.map((e) => ({
        tenantId: caller.tenantId,
        userId: caller.userId,
        role: caller.role ?? null,
        kind: e.kind,
        task: e.task ?? null,
        outcome: e.outcome ?? null,
        durationMs: e.durationMs ?? null,
        clicks: e.clicks ?? null,
        fields: e.fields ?? null,
        route: e.route ?? null,
        appVersion: e.appVersion ?? null,
      })),
    );
    return { accepted: dto.events.length };
  }

  /**
   * Should this person be asked today? After two weeks at the hotel, at most once a quarter,
   * and never within two weeks of "Not now".
   */
  async survey(caller: Caller) {
    const now = Date.now();
    const [member] = await this.dbs.db
      .select({ createdAt: memberships.createdAt })
      .from(memberships)
      .where(and(eq(memberships.userId, caller.userId), eq(memberships.tenantId, caller.tenantId)));
    const tenureOk =
      !!member && now - member.createdAt.getTime() >= SURVEY_MIN_TENURE_DAYS * DAY_MS;

    const [answered] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(uxSurveyResponses)
      .where(
        and(
          eq(uxSurveyResponses.tenantId, caller.tenantId),
          eq(uxSurveyResponses.userId, caller.userId),
          gte(uxSurveyResponses.createdAt, new Date(now - SURVEY_INTERVAL_DAYS * DAY_MS)),
        ),
      );
    const [snoozed] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(uxEvents)
      .where(
        and(
          eq(uxEvents.tenantId, caller.tenantId),
          eq(uxEvents.userId, caller.userId),
          eq(uxEvents.kind, 'survey_dismissed'),
          gte(uxEvents.createdAt, new Date(now - SURVEY_SNOOZE_DAYS * DAY_MS)),
        ),
      );

    return {
      eligible: tenureOk && (answered?.n ?? 0) === 0 && (snoozed?.n ?? 0) === 0,
      items: SURVEY_ITEMS.map(({ key, text }) => ({ key, text })),
    };
  }

  async answer(caller: Caller, dto: UxSurveyDto): Promise<{ saved: true }> {
    await this.dbs.db.insert(uxSurveyResponses).values({
      tenantId: caller.tenantId,
      userId: caller.userId,
      role: caller.role ?? null,
      answers: dto.answers,
      comment: dto.comment || null,
    });
    return { saved: true };
  }

  /** The staff console's scoreboard: every tenant, or one. */
  async scoreboard(q: ScoreboardQueryDto) {
    // Raw SQL binds strings, not Dates: pass the instant as ISO text and cast it in the query.
    const since = sql`${new Date(Date.now() - q.days * DAY_MS).toISOString()}::timestamptz`;
    const scope = q.tenantId ? sql`and tenant_id = ${q.tenantId}` : sql``;

    const tasks = (await this.dbs.db.execute(sql`
      select task,
             count(*) filter (where outcome = 'completed')::int as completed,
             count(*) filter (where outcome = 'abandoned')::int as abandoned,
             percentile_cont(0.5) within group (order by duration_ms)
               filter (where outcome = 'completed') as "medianMs",
             percentile_cont(0.9) within group (order by duration_ms)
               filter (where outcome = 'completed') as "p90Ms",
             percentile_cont(0.5) within group (order by clicks)
               filter (where outcome = 'completed') as "medianClicks"
      from ux_events
      where kind = 'task' and task is not null and created_at >= ${since} ${scope}
      group by task
      order by task
    `)) as unknown as Array<{
      task: string;
      completed: number;
      abandoned: number;
      medianMs: number | null;
      p90Ms: number | null;
      medianClicks: number | null;
    }>;

    const answers = (await this.dbs.db.execute(sql`
      select a.key,
             count(*)::int as n,
             avg(a.value::int)::float as mean,
             (100.0 * count(*) filter (where a.value::int >= 4) / count(*))::float as "agreePct"
      from ux_survey_responses r, jsonb_each_text(r.answers) as a(key, value)
      where r.created_at >= ${since} ${q.tenantId ? sql`and r.tenant_id = ${q.tenantId}` : sql``}
      group by a.key
    `)) as unknown as Array<{ key: string; n: number; mean: number; agreePct: number }>;
    const byKey = new Map(answers.map((a) => [a.key, a]));

    const [errors] = (await this.dbs.db.execute(sql`
      select count(*)::int as n from ux_events
      where kind = 'client_error' and created_at >= ${since} ${scope}
    `)) as unknown as Array<{ n: number }>;

    return {
      days: q.days,
      tasks: tasks.map((t) => ({
        ...t,
        medianMs: t.medianMs === null ? null : Math.round(Number(t.medianMs)),
        p90Ms: t.p90Ms === null ? null : Math.round(Number(t.p90Ms)),
        medianClicks: t.medianClicks === null ? null : Number(t.medianClicks),
      })),
      survey: SURVEY_ITEMS.map((item) => {
        const a = byKey.get(item.key);
        return {
          key: item.key,
          text: item.text,
          responses: a?.n ?? 0,
          agreePct: a ? Math.round(a.agreePct * 10) / 10 : null,
          mean: a ? Math.round(a.mean * 100) / 100 : null,
          baselinePct: item.baselinePct,
        };
      }),
      clientErrors: errors?.n ?? 0,
      mistakes: await this.mistakes(since, q.tenantId),
    };
  }

  /**
   * Signals that someone did something and immediately had to take it back — read from the
   * records themselves, so they need no instrumentation and cannot be gamed by it.
   */
  private async mistakes(since: SQL, tenantId?: string) {
    const ids = tenantId
      ? [tenantId]
      : (await this.dbs.db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
    const total = { quickVoids: 0, quickCancels: 0, quickCreditNotes: 0 };
    for (const id of ids) {
      const [row] = await this.dbs.withTenant(id, async (tx) => {
        return (await tx.execute(sql`
          select
            (select count(*)::int from folio_charges
              where voided_at >= ${since}
                and voided_at - created_at < interval '10 minutes') as "quickVoids",
            (select count(*)::int from booking_approvals a
              join bookings b on b.id = a.booking_id
              where a.action = 'cancelled' and a.created_at >= ${since}
                and a.created_at - b.created_at < interval '5 minutes') as "quickCancels",
            (select count(*)::int from invoices cn
              join invoices orig on orig.id = cn.original_invoice_id
              where cn.kind = 'credit_note' and cn.issued_at >= ${since}
                and cn.issued_at - orig.issued_at < interval '1 day') as "quickCreditNotes"
        `)) as unknown as Array<typeof total>;
      });
      if (row) {
        total.quickVoids += row.quickVoids;
        total.quickCancels += row.quickCancels;
        total.quickCreditNotes += row.quickCreditNotes;
      }
    }
    return total;
  }
}
