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

/** The shape carried in the JWT and attached to the request as `req.user`. */
export interface AuthPrincipal {
  sub: string;
  email: string;
  memberships: Array<{ tenantId: string | null; role: string }>;
}
