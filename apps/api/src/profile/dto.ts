import { z } from 'zod';

export const payoutAccountSchema = z.object({
  bankName: z.string().min(1).max(200),
  branchName: z.string().max(200).optional(),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().min(4).max(50),
  swiftCode: z.string().max(20).optional(),
});
export type PayoutAccountDto = z.infer<typeof payoutAccountSchema>;
