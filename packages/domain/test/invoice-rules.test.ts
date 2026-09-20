import { describe, expect, it } from 'vitest';
import {
  LK_SERIAL_MAX,
  documentNumber,
  fiscalYear,
  formatInvoiceDate,
  invoiceTitle,
  isLkTin,
  lkBranchCode,
  lkInvoiceSerial,
  scaleTaxLines,
  summariseTaxes,
  toLocalCurrency,
  vatOf,
} from '../src/invoice-rules';
import type { TaxLine } from '../src/tax-split';

const night: TaxLine[] = [
  { key: 'sc', name: 'Service Charge', priority: 1, rate: 0.1, amount: 751.63, exemptible: false },
  { key: 'sscl', name: 'SSCL', priority: 2, rate: 0.025, amount: 206.7, exemptible: false },
  { key: 'vat', name: 'VAT', priority: 3, rate: 0.18, amount: 1525.42, exemptible: true },
];

describe('Sri Lankan tax invoice serial (Gazette 2481/22)', () => {
  it('is YYMMM-QQQQ-n', () => {
    expect(lkInvoiceSerial('2026-09-18', '1', 42)).toBe('26SEP-0001-42');
    expect(lkInvoiceSerial('2027-01-02', null, 1)).toBe('27JAN-0001-1');
    expect(lkInvoiceSerial('2026-12-31', 'col-2', 7)).toBe('26DEC-COL2-7');
  });

  it('never runs past 40 characters', () => {
    const serial = lkInvoiceSerial('2026-09-18', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 999_999_999);
    expect(serial.length).toBeLessThanOrEqual(LK_SERIAL_MAX);
    expect(lkBranchCode('ABCDEFGHIJKLMNOP')).toHaveLength(12);
  });

  it('refuses a bad date or number', () => {
    expect(() => lkInvoiceSerial('2026-13-01', '1', 1)).toThrow();
    expect(() => lkInvoiceSerial('2026-01-01', '1', 0)).toThrow();
  });
});

describe('numbering and dates', () => {
  it('names the fiscal year from its start month', () => {
    expect(fiscalYear('2026-09-18', 4)).toBe('2026-27');
    expect(fiscalYear('2027-03-31', 4)).toBe('2026-27');
    expect(fiscalYear('2027-04-01', 4)).toBe('2027-28');
    expect(fiscalYear('2026-09-18', 1)).toBe('2026');
  });

  it('numbers the other documents in their own series', () => {
    expect(documentNumber('credit_note', '2026-27', 3)).toBe('CN-2026-27-00003');
    expect(documentNumber('proforma', '2026-27', 12)).toBe('PF-2026-27-00012');
    expect(documentNumber('invoice', '2026', 1, 'lkh')).toBe('LKH-2026-00001');
    expect(documentNumber('bill', '2026', 1, 'LKH')).toBe('BL-2026-00001');
  });

  it('prints MM/DD/YYYY on a Sri Lankan tax invoice and DD/MM/YYYY otherwise', () => {
    expect(formatInvoiceDate('2026-09-18', 'lk_vat')).toBe('09/18/2026');
    expect(formatInvoiceDate('2026-09-18', 'generic')).toBe('18/09/2026');
  });

  it('titles each kind', () => {
    expect(invoiceTitle('tax_invoice')).toBe('TAX INVOICE');
    expect(invoiceTitle('credit_note')).toBe('CREDIT NOTE');
    expect(invoiceTitle('legacy')).toBe('INVOICE');
  });

  it('checks a TIN', () => {
    expect(isLkTin('114523678')).toBe(true);
    expect(isLkTin('114-523-678-7000')).toBe(true);
    expect(isLkTin('11452367')).toBe(false);
  });
});

describe('tax lines', () => {
  it('finds the VAT among the taxes', () => {
    expect(vatOf(night)).toBe(1525.42);
    expect(vatOf([{ name: 'VAT 18%', priority: 9, amount: 10 }])).toBe(10);
  });

  it('scales a night to the rooms and totals each tax across lines', () => {
    const two = scaleTaxLines(night, 2);
    expect(two.map((t) => t.amount)).toEqual([1503.26, 413.4, 3050.84]);
    const summary = summariseTaxes([{ taxLines: night }, { taxLines: two }]);
    expect(summary.map((s) => [s.key, s.amount])).toEqual([
      ['sc', 2254.89],
      ['sscl', 620.1],
      ['vat', 4576.26],
    ]);
  });

  it('converts to the local currency to the cent', () => {
    expect(toLocalCurrency(100.1, 300.555)).toBe(30085.56);
  });
});
