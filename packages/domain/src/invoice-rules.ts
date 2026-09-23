import { roundMoney, sumMoney, toCents } from './money';
import type { TaxLine } from './tax-split';

/**
 * Invoices (Development Phase 02, Sprint 6): what a document is called, how it is numbered and
 * how its dates print, per country profile. Pure — the API decides which rule applies and takes
 * the number from the property's gap-free series.
 *
 * Sri Lanka follows Inland Revenue Gazette 2481/22 (in force from 2026-07-01): a document headed
 * "TAX INVOICE", the supplier's TIN and the purchaser's TIN, a serial `YYMMM-QQQQ-n` of at most 40
 * characters, dates as MM/DD/YYYY, amounts in LKR to two decimals (with LKR equivalents on a
 * foreign-currency invoice), and only VAT-able supplies on it.
 */

export const INVOICE_KINDS = [
  /** `INV-<booking reference>`, the pre-Phase-02 one-per-booking invoice. Kept as it was. */
  'legacy',
  /** A VAT-registered Sri Lankan supplier's tax invoice (Gazette 2481/22). */
  'tax_invoice',
  /** An invoice from a supplier with no tax-invoice profile. */
  'invoice',
  /** What a Sri Lankan tax invoice may not carry: the supplies with no VAT on them. */
  'bill',
  'proforma',
  'credit_note',
] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** The documents a folio window is invoiced with; at most one of each is live at a time. */
export const FOLIO_INVOICE_KINDS: readonly InvoiceKind[] = ['tax_invoice', 'invoice', 'bill'];

/**
 * - `lk_vat` — Sri Lanka, Gazette 2481/22 (Sprint 6).
 * - `in_gst` — India (Sprint 7): a TAX INVOICE with supplier and buyer GSTIN, place of supply,
 *   SAC 996311, GST printed as CGST + SGST, a serial of at most 16 characters that restarts each
 *   April, and the total rounded to the rupee.
 * - `my_sst` — Malaysia (Sprint 7): the SST registration number, and the Tourism Tax on its own
 *   line with the TTx number.
 * - `generic` — anyone else.
 */
export type InvoiceProfile = 'lk_vat' | 'generic' | 'in_gst' | 'my_sst';

/** India's accommodation services code, printed on a GST tax invoice. */
export const INDIA_ACCOMMODATION_SAC = '996311';

/** The longest invoice number India's GST rules allow. */
export const IN_SERIAL_MAX = 16;

/**
 * An Indian GST invoice number: `INV/26-27/000042` — prefix, the financial year's two-digit
 * years, then the running number of that year's series. At most 16 characters (CGST Rule 46);
 * the prefix is shortened to fit, never the number.
 */
export function inInvoiceSerial(fy: string, n: number, prefix?: string | null): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`bad serial number ${n}`);
  const years = /^\d{4}-\d{2}$/.test(fy) ? `${fy.slice(2, 4)}-${fy.slice(5, 7)}` : fy.slice(-5);
  const own = (prefix ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const digits = String(n).padStart(6, '0');
  const room = IN_SERIAL_MAX - years.length - digits.length - 2;
  if (room < 1) throw new Error(`invoice number ${n} does not fit in ${IN_SERIAL_MAX} characters`);
  const head = (own || 'INV').slice(0, room);
  return `${head}/${years}/${digits}`;
}

/** An Indian GSTIN: 2-digit state code, 10-character PAN, entity digit, Z, check character. */
export function isGstin(value: string | null | undefined): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test((value ?? '').trim().toUpperCase());
}

/** Who is on the invoice — the supplier or the purchaser — frozen at issue. */
export interface InvoiceParty {
  name: string;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Taxpayer number: Sri Lanka TIN / VAT number, India GSTIN, Malaysia TIN. */
  taxId?: string | null;
  registrationNo?: string | null;
  branchCode?: string | null;
  /** India: the GST state code — the place of supply for a hotel stay (Sprint 7). */
  stateCode?: string | null;
  /** Malaysia: the Tourism Tax registration number, printed beside the TTx line (Sprint 7). */
  ttxNo?: string | null;
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/** The longest serial the gazette allows. */
export const LK_SERIAL_MAX = 40;

/** The branch part of a Sri Lankan serial: `QQQQ`, digits padded to four, else letters as given. */
export function lkBranchCode(branchCode: string | null | undefined): string {
  const raw = (branchCode ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!raw) return '0001';
  return /^\d+$/.test(raw) && raw.length < 4 ? raw.padStart(4, '0') : raw.slice(0, 12);
}

/**
 * A Sri Lankan tax invoice serial: `26SEP-0001-42` — year, month, branch, then the running number
 * of that month's series.
 */
export function lkInvoiceSerial(
  date: string,
  branchCode: string | null | undefined,
  n: number,
): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  if (!month || !Number.isInteger(n) || n < 1) throw new Error(`bad serial input ${date} ${n}`);
  const serial = `${date.slice(2, 4)}${month}-${lkBranchCode(branchCode)}-${n}`;
  if (serial.length > LK_SERIAL_MAX) {
    throw new Error(`invoice serial ${serial} is longer than ${LK_SERIAL_MAX} characters`);
  }
  return serial;
}

/** The numbering period of a Sri Lankan tax invoice series: its month (the serial carries it). */
export function lkSerialPeriod(date: string): string {
  return date.slice(0, 7);
}

/**
 * The fiscal year a date falls in: `2026-27` for a year starting in April, `2026` for one starting
 * in January.
 */
export function fiscalYear(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startMonth <= 1) return String(y);
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const PREFIX: Record<Exclude<InvoiceKind, 'legacy' | 'tax_invoice'>, string> = {
  invoice: 'INV',
  bill: 'BL',
  proforma: 'PF',
  credit_note: 'CN',
};

/**
 * Any other document's number: `INV-2026-27-00042`. A property's own invoice prefix replaces
 * `INV` (letters, digits and dashes only).
 */
export function documentNumber(
  kind: Exclude<InvoiceKind, 'legacy' | 'tax_invoice'>,
  fy: string,
  n: number,
  invoicePrefix?: string | null,
): string {
  const own = (invoicePrefix ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  const prefix = kind === 'invoice' && own ? own : PREFIX[kind];
  return `${prefix}-${fy}-${String(n).padStart(5, '0')}`;
}

/** The heading printed on a document. */
export function invoiceTitle(kind: InvoiceKind): string {
  switch (kind) {
    case 'tax_invoice':
      return 'TAX INVOICE';
    case 'bill':
      return 'BILL';
    case 'proforma':
      return 'PRO-FORMA INVOICE';
    case 'credit_note':
      return 'CREDIT NOTE';
    default:
      return 'INVOICE';
  }
}

/** Dates on a document: MM/DD/YYYY on a Sri Lankan tax invoice (the gazette's order), else DD/MM/YYYY. */
export function formatInvoiceDate(iso: string, profile: InvoiceProfile): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return profile === 'lk_vat' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

/** A Sri Lankan Taxpayer Identification Number: nine digits (a VAT number adds four more). */
export function isLkTin(value: string | null | undefined): boolean {
  return /^\d{9}(\d{4})?$/.test((value ?? '').replace(/[\s-]/g, ''));
}

/** Is this tax VAT? The third slot of the Sri Lankan compounding, or a tax named so. */
export function isVat(line: Pick<TaxLine, 'priority' | 'name'>): boolean {
  return line.priority === 3 || /\bvat\b/i.test(line.name);
}

/** The VAT inside a line's taxes. */
export function vatOf(lines: readonly Pick<TaxLine, 'priority' | 'name' | 'amount'>[]): number {
  return sumMoney(lines.filter(isVat).map((l) => l.amount));
}

/** Scale a night's tax lines to `quantity` rooms, keeping every amount to the cent. */
export function scaleTaxLines(lines: readonly TaxLine[], quantity: number): TaxLine[] {
  return lines.map((l) => ({ ...l, amount: roundMoney(l.amount * quantity) }));
}

/**
 * One total per tax across a document's lines, in the order the taxes compound. Taxes are one row
 * by name and rate — a room's VAT and a minibar's VAT at 18% are the same VAT on the invoice.
 */
export function summariseTaxes(
  lines: readonly { taxLines: readonly TaxLine[] }[],
): Array<{ key: string; name: string; rate: number; priority: number; amount: number }> {
  const by = new Map<
    string,
    { key: string; name: string; rate: number; priority: number; cents: number }
  >();
  for (const l of lines) {
    for (const t of l.taxLines) {
      const id = `${t.name.trim().toLowerCase()}:${t.rate}`;
      const row = by.get(id) ?? {
        key: t.key,
        name: t.name,
        rate: t.rate,
        priority: t.priority,
        cents: 0,
      };
      row.cents += toCents(t.amount);
      by.set(id, row);
    }
  }
  return [...by.values()]
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .map(({ cents, ...r }) => ({ ...r, amount: cents / 100 }));
}

/** An amount in the local currency at the invoice date's rate, to the cent. */
export function toLocalCurrency(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}
