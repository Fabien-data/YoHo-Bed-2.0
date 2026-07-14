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

/** The shape carried in the JWT and attached to the request as `req.user`. */
export interface AuthPrincipal {
  sub: string;
  email: string;
  memberships: Array<{ tenantId: string | null; role: string }>;
}
