import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '@yohobed/domain';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const recordPaymentSchema = z.object({
  direction: z.enum(['received', 'sent']),
  amount: z.number().positive(),
  /**
   * Optional assertion, not a choice: the payment is stored in the booking's currency regardless.
   * Supplying it makes an integrating client's assumption explicit so a mismatch fails loudly
   * instead of booking a dollar figure against a rupee invoice.
   */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  method: z.enum(['cash', 'card', 'bank', 'online']).default('bank'),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const createPayoutSchema = z
  .object({
    propertyId: z.string().uuid(),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type CreatePayoutDto = z.infer<typeof createPayoutSchema>;

// --- Invoices (Development Phase 02, Sprint 6) ------------------------------------------------

const partyField = z.string().trim().max(300).optional();

/** Issue a folio window's invoice. The purchaser defaults to the window's payer on file. */
export const issueInvoiceSchema = z.object({
  /** What the desk types at the counter: a company's name and TIN the guest gives at check-out. */
  payer: z
    .object({
      name: partyField,
      legalName: partyField,
      address: partyField,
      city: partyField,
      country: partyField,
      email: partyField,
      phone: partyField,
      taxId: z.string().trim().max(40).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    })
    .strict()
    .optional(),
  notes: z.string().trim().max(500).optional(),
});
export type IssueInvoiceDto = z.infer<typeof issueInvoiceSchema>;

export const proformaSchema = issueInvoiceSchema;
export type ProformaDto = IssueInvoiceDto;

export const creditNoteSchema = z.object({
  /** Why the invoice is cancelled. Required — Malaysia's rules need it, and every auditor asks. */
  reason: z.string().trim().min(3).max(300),
});
export type CreditNoteDto = z.infer<typeof creditNoteSchema>;

export const listInvoicesQuerySchema = z.object({
  propertyId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  folioId: z.string().uuid().optional(),
  kind: z.enum(['legacy', 'tax_invoice', 'invoice', 'bill', 'proforma', 'credit_note']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const updateSequenceSchema = z.object({
  docType: z.enum(['receipt', 'tax_invoice', 'invoice', 'bill', 'credit_note', 'proforma']),
  /** The series period as shown by GET: a month (`2026-09`), a fiscal year (`2026-27`) or a year. */
  period: z
    .string()
    .trim()
    .regex(/^\d{4}(-\d{2})?$/, 'a period like 2026, 2026-27 or 2026-09'),
  /** The number the next document gets. Only ever raised: lowering it would repeat numbers. */
  nextValue: z.number().int().min(1).max(99_999_999),
});
export type UpdateSequenceDto = z.infer<typeof updateSequenceSchema>;
