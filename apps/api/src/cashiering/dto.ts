import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '@yohobed/domain';

export const createLedgerAccountSchema = z.object({
  propertyId: z.string().uuid().optional(),
  type: z.enum(['travel_agent', 'company', 'sales_person', 'other']).default('company'),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(160),
  contactName: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(60).optional(),
  /** 0 means no limit is enforced. */
  creditLimit: z.number().min(0).default(0),
  /** Defaults to the property's base currency; a typo here would block chargeToLedger forever. */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
});
export type CreateLedgerAccountDto = z.infer<typeof createLedgerAccountSchema>;

export const chargeToLedgerSchema = z.object({
  ledgerAccountId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(200).optional(),
  reference: z.string().max(120).optional(),
});
export type ChargeToLedgerDto = z.infer<typeof chargeToLedgerSchema>;

export const settleLedgerSchema = z.object({
  amount: z.number().positive(),
  description: z.string().max(200).optional(),
  reference: z.string().max(120).optional(),
});
export type SettleLedgerDto = z.infer<typeof settleLedgerSchema>;

export const createDrawerSchema = z.object({ name: z.string().min(1).max(80) });
export type CreateDrawerDto = z.infer<typeof createDrawerSchema>;

export const openDrawerSchema = z.object({ openingFloat: z.number().min(0).default(0) });
export type OpenDrawerDto = z.infer<typeof openDrawerSchema>;

export const closeDrawerSchema = z.object({
  /** What the cashier physically counted. */
  declaredTotal: z.number().min(0),
  notes: z.string().max(500).optional(),
});
export type CloseDrawerDto = z.infer<typeof closeDrawerSchema>;

export const createExpenseSchema = z.object({
  drawerSessionId: z.string().uuid().optional(),
  voucherNo: z.string().max(32).optional(),
  category: z
    .enum(['supplies', 'maintenance', 'transport', 'staff', 'utilities', 'other'])
    .default('other'),
  payee: z.string().min(1).max(160),
  amount: z.number().positive(),
  /** Defaults to the property's base currency. */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});
export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;

export const propertyQuerySchema = z.object({ propertyId: z.string().uuid() });
export type PropertyQueryDto = z.infer<typeof propertyQuerySchema>;
