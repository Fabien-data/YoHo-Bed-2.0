import { z } from 'zod';

/** Validated environment. Fails fast at boot if anything required is missing. */
export const envSchema = z.object({
  APP_DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
