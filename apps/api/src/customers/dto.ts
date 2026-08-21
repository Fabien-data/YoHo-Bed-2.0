import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * Guest depth — what a registration card and a police/immigration report need.
 *
 * Every field is nullable and optional: an OTA booking arrives with a name and little else, and
 * the front desk fills the rest in at check-in. Demanding more would block the very check-in this
 * exists to support.
 */
export const updateCustomerSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    nationality: z.string().max(80).nullable().optional(),
    idType: z.string().max(40).nullable().optional(),
    idNumber: z.string().max(80).nullable().optional(),
    dateOfBirth: isoDate.nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    country: z.string().max(120).nullable().optional(),
    vip: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
