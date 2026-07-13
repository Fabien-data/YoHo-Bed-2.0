import { z } from 'zod';

/** Validated environment. Fails fast at boot if anything required is missing. */
export const envSchema = z.object({
  APP_DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
  /** Shared secret the channel manager sends on POST /cm/reservations (x-cm-secret header). */
  CM_WEBHOOK_SECRET: z.string().min(16).default('dev-cm-webhook-secret-0001'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
