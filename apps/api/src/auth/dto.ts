import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/** Self-serve owner signup (Compartment H). Creates a PENDING tenant awaiting staff approval. */
export const registerSchema = z.object({
  ownerName: z.string().min(1).max(200),
  businessName: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/**
 * What an owner can approve on the spot for a desk user (Development Phase 02):
 * - rate_override: a nightly rate below the property's staff discount limit
 * - complimentary: a free room when staff may not comp
 * - tax_exempt: removing taxes from a reservation
 */
export const STEP_UP_ACTIONS = ['rate_override', 'complimentary', 'tax_exempt'] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const stepUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  action: z.enum(STEP_UP_ACTIONS),
  reason: z.string().max(300).optional(),
});
export type StepUpDto = z.infer<typeof stepUpSchema>;

/** The shape carried in the JWT and attached to the request as `req.user`. */
export interface AuthPrincipal {
  sub: string;
  email: string;
  memberships: Array<{ tenantId: string | null; role: string }>;
}
