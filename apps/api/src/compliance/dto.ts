import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-22')
  .nullable()
  .optional();

/** The journey part of a stay's registration (Form C and Malaysia's register). */
export const registrationSchema = z
  .object({
    arrivedFrom: text(120),
    arrivedInCountryOn: isoDate,
    portOfEntry: text(120),
    nextDestination: text(120),
    purposeOfVisit: text(120),
  })
  .strict();
export type RegistrationDto = z.infer<typeof registrationSchema>;

/** Form C filed on the Bureau of Immigration portal: its application reference. */
export const formCSubmitSchema = z
  .object({
    reference: z.string().trim().min(3, 'Enter the Form C reference').max(60),
    /** When it was filed, if not now (filed earlier, recorded later). */
    submittedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type FormCSubmitDto = z.infer<typeof formCSubmitSchema>;
