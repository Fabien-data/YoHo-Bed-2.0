import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'expected a two-letter country code')
  .transform((v) => v.toUpperCase());

/**
 * Guest depth — what a registration card and a police/immigration report need, plus the regional
 * profile of Development Phase 02 (title, WhatsApp, ISO nationality, company and tax number).
 *
 * Every field is nullable and optional: an OTA booking arrives with a name and little else, and
 * the front desk fills the rest in at check-in. Demanding more would block the very check-in this
 * exists to support.
 */
const profileFields = {
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(24).nullable(),
  givenName: z.string().trim().max(120).nullable(),
  familyName: z.string().trim().max(120).nullable(),
  email: z.string().trim().email().max(200).nullable(),
  phone: z.string().trim().max(40).nullable(),
  whatsapp: z.boolean(),
  nationality: z.string().max(80).nullable(),
  nationalityCode: countryCode.nullable(),
  countryCode: countryCode.nullable(),
  idType: z.string().max(40).nullable(),
  idNumber: z.string().max(80).nullable(),
  dateOfBirth: isoDate.nullable(),
  address: z.string().max(300).nullable(),
  city: z.string().max(120).nullable(),
  state: z.string().max(80).nullable(),
  zip: z.string().max(20).nullable(),
  country: z.string().max(120).nullable(),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  occupation: z.string().max(120).nullable(),
  companyName: z.string().max(200).nullable(),
  taxId: z.string().max(40).nullable(),
  vip: z.boolean(),
  notes: z.string().max(2000).nullable(),
  /** The guest agreed to the privacy notice now (India's DPDP); the server stamps the time. */
  consentVersion: z.string().trim().max(40).nullable(),
};

export const updateCustomerSchema = z
  .object(profileFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;

export const createCustomerSchema = z
  .object(profileFields)
  .partial()
  .required({ name: true })
  .extend({
    /** Save as a new guest even though one with this email or mobile exists. */
    createNew: z.boolean().optional(),
  })
  .strict();
export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;

export const searchCustomersSchema = z.object({
  q: z.string().trim().min(2, 'type at least two characters').max(120),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});
export type SearchCustomersDto = z.infer<typeof searchCustomersSchema>;
