import { z } from 'zod';
import { SURVEY_KEYS } from './survey';

/** `reservation.quick`, `stay.check_in` … — a fixed catalogue key, never free text. */
export const TASK_KEY = /^[a-z][a-z_]*(\.[a-z][a-z_]*){1,3}$/;

/**
 * The route as a pattern. The client sends `/app/invoices/[id]`, not the real URL; anything that
 * still looks like an id or a number is masked here too, so no reference can ever be stored.
 */
function maskRoute(route: string): string {
  return route
    .split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\d+/g, '[n]')
    .slice(0, 120);
}

const uxEvent = z.object({
  kind: z.enum(['task', 'client_error', 'survey_shown', 'survey_dismissed']),
  task: z.string().max(64).regex(TASK_KEY).optional(),
  outcome: z.enum(['completed', 'abandoned']).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  clicks: z.number().int().min(0).max(5_000).optional(),
  fields: z.number().int().min(0).max(500).optional(),
  route: z
    .string()
    .max(500)
    .regex(/^\/[^\s]*$/)
    .transform(maskRoute)
    .optional(),
  appVersion: z.string().max(40).optional(),
});
// Unknown keys are stripped, not refused: a newer web build must never lose a whole batch.

export const uxEventsSchema = z.object({ events: z.array(uxEvent).min(1).max(50) });
export type UxEventsDto = z.infer<typeof uxEventsSchema>;

export const uxSurveySchema = z.object({
  answers: z
    .record(z.enum(SURVEY_KEYS), z.number().int().min(1).max(5))
    .refine((a) => SURVEY_KEYS.every((k) => a[k] !== undefined), {
      message: 'Answer every statement',
    }),
  comment: z.string().trim().max(1_000).optional(),
});
export type UxSurveyDto = z.infer<typeof uxSurveySchema>;

export const scoreboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  tenantId: z.string().uuid().optional(),
});
export type ScoreboardQueryDto = z.infer<typeof scoreboardQuerySchema>;
