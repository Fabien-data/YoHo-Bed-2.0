import { z } from 'zod';
import { BASE_CURRENCIES } from '@yohobed/domain';

export const setTenantStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']),
});
export type SetTenantStatusDto = z.infer<typeof setTenantStatusSchema>;

/**
 * A property's base currency is a commercial term, not an owner preference: it decides the
 * denomination of settlement and must match the payee bank account. Staff-only, and only while
 * the property has no bookings (see StaffService.setPropertyCurrency).
 */
export const setPropertyCurrencySchema = z.object({
  currency: z.enum(BASE_CURRENCIES),
});
export type SetPropertyCurrencyDto = z.infer<typeof setPropertyCurrencySchema>;

export const rejectSchema = z.object({ reason: z.string().max(500).optional() });
export type RejectDto = z.infer<typeof rejectSchema>;
