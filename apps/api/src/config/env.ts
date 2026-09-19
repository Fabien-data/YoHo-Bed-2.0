import { z } from 'zod';

/** Validated environment. Fails fast at boot if anything required is missing. */
export const envSchema = z.object({
  APP_DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
  /** Shared secret the channel manager sends on POST /cm/reservations (x-cm-secret header). */
  CM_WEBHOOK_SECRET: z.string().min(16).default('dev-cm-webhook-secret-0001'),
  /** Email seam (Compartment H): 'console' logs instead of sending; 'resend' needs the API key. */
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('YoHoBed <onboarding@resend.dev>'),
  /** Public web app origin, used to build links in emails (reset password, etc.). */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Where uploaded photos live (local-disk storage adapter). */
  MEDIA_DIR: z.string().default('./uploads'),
  /**
   * Payment slips and ID scans (Development Phase 02). Never inside MEDIA_DIR, which is served
   * publicly: these are served only to a signed-in member of the tenant.
   */
  PRIVATE_FILES_DIR: z.string().default('./private-files'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
