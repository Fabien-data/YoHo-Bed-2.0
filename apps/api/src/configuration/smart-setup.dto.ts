import { z } from 'zod';

const count = z.number().int().min(0).max(100);
const money = z.number().int().min(0).max(10_000_000_000);
const supplement = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed'), amountMinor: money }).strict(),
  z
    .object({ mode: z.literal('percent'), basisPoints: z.number().int().min(0).max(100_000) })
    .strict(),
]);
const roomPolicy = z
  .object({
    capacity: z
      .object({
        maxAdults: count,
        maxChildren: count,
        normalGuests: count,
        absoluteGuests: count,
        maxExtraBeds: count,
        maxCots: count,
      })
      .strict(),
    includedAdults: count,
    includedChildren: count,
    childUsesAdultPlace: z.boolean(),
    extraAdultMinor: money,
    extraBedMinor: money,
    cotMinor: money,
    childBands: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(40),
            label: z.string().trim().min(1).max(80),
            minAge: z.number().int().min(0).max(17),
            maxAge: z.number().int().min(0).max(17),
            accommodation: supplement,
          })
          .strict(),
      )
      .max(18),
  })
  .strict();
export const smartDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    readiness: z.enum(['clean', 'inspected']),
    defaults: roomPolicy,
    roomOverrides: z.record(z.string().uuid(), roomPolicy),
    rates: z.record(
      z.string().uuid(),
      z
        .object({
          roomId: z.string().uuid(),
          baseOccupancyId: z.string().uuid(),
          includedAdults: count,
          includedChildren: count,
          meal: z
            .object({
              code: z.enum(['RO', 'BB', 'HB', 'FB', 'AI']),
              mode: z.enum(['derived', 'independent']),
              adultMealMinor: money,
              childMeals: z.record(z.string().max(40), supplement),
              minimumNetMinor: money,
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();
export const saveSmartDraftSchema = z
  .object({ expectedVersion: z.number().int().min(0), document: smartDocumentSchema })
  .strict();
export const publishSmartSchema = z
  .object({ expectedVersion: z.number().int().min(1), acknowledgeChannelLimit: z.literal(true) })
  .strict();
export type PublishSmartDto = z.infer<typeof publishSmartSchema>;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Enter a valid date',
  );
export const smartPreviewSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    occupancyId: z.string().uuid(),
    checkin: date,
    checkout: date,
    guests: z
      .object({
        adults: count,
        childAges: z.array(z.number().int().min(0).max(17)).max(100),
        extraBeds: count,
        cots: count,
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.checkout > value.checkin &&
      Date.parse(value.checkout) - Date.parse(value.checkin) <= 366 * 86400000,
    { path: ['checkout'], message: 'Choose a stay from 1 to 366 nights' },
  );
export type SaveSmartDraftDto = z.infer<typeof saveSmartDraftSchema>;
export type SmartPreviewDto = z.infer<typeof smartPreviewSchema>;
