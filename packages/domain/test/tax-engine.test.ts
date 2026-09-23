import { describe, expect, it } from 'vitest';
import {
  displayTaxLines,
  exemptNight,
  forwardNight,
  formCRequired,
  gstHalves,
  inInvoiceSerial,
  isGstin,
  levyExemption,
  levyForNight,
  registrationMissing,
  rupeeRoundOff,
  splitInclusiveTax,
  sumMoney,
  taxFromSelling,
  type ForwardTax,
  type Levy,
} from '../src';

const MY: ForwardTax[] = [
  {
    key: 'sc',
    name: 'Service Charge',
    code: 'SC',
    priority: 1,
    rate: 0.1,
    exemptible: false,
    compound: false,
  },
  {
    key: 'sst',
    name: 'SST',
    code: 'SST',
    priority: 2,
    rate: 0.08,
    exemptible: true,
    compound: true,
  },
];

const IN: ForwardTax[] = [
  {
    key: 'gst',
    name: 'GST',
    code: 'GST',
    priority: 1,
    rate: 0.05,
    exemptible: true,
    compound: false,
    displayGroup: 'gst_split',
    maxAmount: 7500,
  },
  {
    key: 'gst',
    name: 'GST',
    code: 'GST',
    priority: 1,
    rate: 0.18,
    exemptible: true,
    compound: false,
    displayGroup: 'gst_split',
    minAmount: 7500.01,
  },
];

describe('forward tax engine (Sprint 7)', () => {
  it('Malaysia: RM200 → 237.60 (SC 20.00 + SST 17.60 on room and service charge)', () => {
    const n = forwardNight(200, MY);
    expect(n.lines.map((l) => [l.code, l.amount])).toEqual([
      ['SC', 20],
      ['SST', 17.6],
    ]);
    expect(n.tax).toBe(37.6);
    expect(n.selling).toBe(237.6);
  });

  it('India: ₹7,500 → 7,875, printed as CGST 187.50 + SGST 187.50', () => {
    const n = forwardNight(7500, IN);
    expect(n.selling).toBe(7875);
    const shown = displayTaxLines(n.lines);
    expect(shown.map((l) => [l.name, l.amount, l.rate])).toEqual([
      ['CGST', 187.5, 0.025],
      ['SGST', 187.5, 0.025],
    ]);
  });

  it('India: ₹8,000 → 9,440 at 18%', () => {
    expect(forwardNight(8000, IN).selling).toBe(9440);
  });

  it('India: the slab boundary — 7,500.00 is 5%, 7,500.01 is 18%', () => {
    expect(forwardNight(7500, IN).lines[0]!.rate).toBe(0.05);
    expect(forwardNight(7500.01, IN).lines[0]!.rate).toBe(0.18);
    expect(forwardNight(7500.01, IN).lines).toHaveLength(1);
  });

  it('a tax-exempt guest is excused the exemptible taxes only — never the service charge', () => {
    const n = forwardNight(200, MY);
    const e = exemptNight(n.selling, n.tax, n.lines);
    expect(e.lines.map((l) => l.code)).toEqual(['SC']);
    expect(e.selling).toBe(220);
    expect(e.tax).toBe(20);
  });

  it('a free night has no tax', () => {
    expect(forwardNight(0, MY)).toMatchObject({ net: 0, tax: 0, selling: 0, lines: [] });
  });

  it('GST halves always add back to the GST, the odd cent to CGST', () => {
    expect(gstHalves(375)).toEqual({ cgst: 187.5, sgst: 187.5 });
    expect(gstHalves(375.01)).toEqual({ cgst: 187.51, sgst: 187.5 });
    for (const a of [0.01, 1.03, 999.99, 1440.37]) {
      const { cgst, sgst } = gstHalves(a);
      expect(sumMoney([cgst, sgst])).toBe(a);
    }
  });

  it('Sri Lanka is untouched: the inclusive split still adds up to the legacy tax exactly', () => {
    const rates = { serviceCharge: 0.1, nbt: 0.025, vat: 0.18 };
    for (const selling of [12345.67, 999.99, 25000]) {
      const tax = taxFromSelling(selling, rates);
      const lines = splitInclusiveTax(
        selling,
        [
          { key: 'sc', name: 'SC', priority: 1, rate: 0.1, exemptible: false },
          { key: 'sscl', name: 'SSCL', priority: 2, rate: 0.025, exemptible: true },
          { key: 'vat', name: 'VAT', priority: 3, rate: 0.18, exemptible: true },
        ],
        tax,
      );
      expect(sumMoney(lines.map((l) => l.amount))).toBe(tax);
    }
  });
});

describe('Indian invoices', () => {
  it('numbers are at most 16 characters and carry the financial year', () => {
    expect(inInvoiceSerial('2026-27', 1)).toBe('INV/26-27/000001');
    expect(inInvoiceSerial('2027-28', 42, 'hotel')).toBe('HOT/27-28/000042');
    expect(inInvoiceSerial('2026-27', 999_999).length).toBeLessThanOrEqual(16);
  });

  it('validates a GSTIN', () => {
    expect(isGstin('29ABCDE1234F1Z5')).toBe(true);
    expect(isGstin('29abcde1234f1z5')).toBe(true);
    expect(isGstin('29ABCDE1234F1X5')).toBe(false);
    expect(isGstin('')).toBe(false);
  });

  it('rounds the invoice to the rupee and shows the difference', () => {
    expect(rupeeRoundOff(9439.5)).toEqual({ rounded: 9440, roundOff: 0.5 });
    expect(rupeeRoundOff(9439.49)).toEqual({ rounded: 9439, roundOff: -0.49 });
    expect(rupeeRoundOff(9440)).toEqual({ rounded: 9440, roundOff: 0 });
  });
});

describe("Malaysia's tourism tax", () => {
  const TTX: Levy = {
    code: 'TTX',
    name: 'Tourism Tax',
    amount: 10,
    currency: 'MYR',
    basis: 'per_room_per_night',
    appliesTo: 'non_resident',
    validFrom: '2017-09-01',
    validTo: null,
  };
  const stay = {
    residency: 'foreign' as const,
    levyExempt: false,
    collectedByChannel: false,
    rooms: 2,
  };

  it('is RM10 per room per night for a foreign guest', () => {
    expect(levyForNight(TTX, stay, '2026-10-01')).toBe(20);
  });

  it('is not charged to a Malaysian, an exempt stay, or when the channel collected it', () => {
    expect(levyExemption(TTX, { ...stay, residency: 'local' })).toBe('resident');
    expect(levyExemption(TTX, { ...stay, levyExempt: true })).toBe('exempt');
    expect(levyExemption(TTX, { ...stay, collectedByChannel: true })).toBe('collected_by_channel');
    expect(levyForNight(TTX, { ...stay, residency: 'local' }, '2026-10-01')).toBe(0);
  });

  it('is not charged before it was in force', () => {
    expect(levyForNight(TTX, stay, '2017-08-31')).toBe(0);
  });
});

describe('registering guests', () => {
  it('India: Form C for foreign nationals, not for Indians, Nepalis or Bhutanese', () => {
    expect(formCRequired('IN', 'GB', null)).toBe(true);
    expect(formCRequired('IN', 'IN', 'foreign')).toBe(false);
    expect(formCRequired('IN', 'NP', null)).toBe(false);
    expect(formCRequired('IN', 'BT', null)).toBe(false);
    expect(formCRequired('IN', null, 'foreign')).toBe(true);
    expect(formCRequired('LK', 'GB', 'foreign')).toBe(false);
  });

  it("Malaysia: names what the register still lacks, in the form's order", () => {
    expect(
      registrationMissing({
        name: 'Aina',
        address: '12 Jalan Ampang',
        gender: 'female',
        nationalityCode: 'MY',
        documentNumber: '900101-14-5678',
      }),
    ).toEqual(['Occupation', 'Place of issue', 'Date of issue', 'Arrived from']);
  });
});
