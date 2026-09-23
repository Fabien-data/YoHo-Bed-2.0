import { roundMoney, sumMoney } from './money';
import type { TaxLine } from './tax-split';

/**
 * Tax engine v2 (Development Phase 02, Sprint 7): taxes charged ON TOP of a pre-tax price.
 *
 * Sri Lanka's legacy engine works backwards — the rate calendar holds a tax-inclusive price and the
 * taxes are decomposed out of it (`taxFromSelling`). India and Malaysia quote rooms before tax, and
 * the tax depends on the pre-tax value itself (India's GST slab), so it cannot be decomposed
 * backwards. A property's `tax_mode` chooses the engine:
 *
 * - `inclusive_legacy` — the parity path, untouched (Sri Lanka, and every existing property).
 * - `exclusive_forward` — this file: each tax computed from the pre-tax price, rounded half-up to
 *   the cent on its own, then added up.
 *
 * Nothing here changes `tax.ts`, `pricing.ts`, `rounding.ts` or `finance.ts`.
 */

export const TAX_MODES = ['inclusive_legacy', 'exclusive_forward'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export function isTaxMode(v: unknown): v is TaxMode {
  return v === 'inclusive_legacy' || v === 'exclusive_forward';
}

/** How a tax prints: India's GST as two equal halves (CGST + SGST), anything else as itself. */
export const TAX_DISPLAY_GROUPS = ['single', 'gst_split'] as const;
export type TaxDisplayGroup = (typeof TAX_DISPLAY_GROUPS)[number];

/** One tax as the forward engine sees it on a date: a tax type with the rate in force. */
export interface ForwardTax {
  /** The tax type id — the line's stable key. */
  key: string;
  name: string;
  /** Short code: SC, SST, GST… */
  code?: string | null;
  /** Order of application; a compound tax is charged on everything before it. */
  priority: number;
  /** Decimal fraction: 0.08 = 8%. */
  rate: number;
  exemptible: boolean;
  /** Charged on the price plus the taxes before it (Malaysia's SST on the service charge). */
  compound: boolean;
  displayGroup?: TaxDisplayGroup | null;
  /**
   * A slab: the rate applies only when the pre-tax value per room per night is within
   * [minAmount, maxAmount], both inclusive. India's GST is two slabs of one tax.
   */
  minAmount?: number | null;
  maxAmount?: number | null;
}

/** Whether a slab covers a pre-tax value (a tax with no bounds always does). */
export function slabCovers(tax: Pick<ForwardTax, 'minAmount' | 'maxAmount'>, net: number) {
  const v = roundMoney(net);
  if (tax.minAmount !== null && tax.minAmount !== undefined && v < roundMoney(tax.minAmount)) {
    return false;
  }
  if (tax.maxAmount !== null && tax.maxAmount !== undefined && v > roundMoney(tax.maxAmount)) {
    return false;
  }
  return true;
}

/**
 * The taxes on a pre-tax price, one line each, in the order they apply.
 *
 * India's slab is chosen on `net` — the discounted pre-tax value per room per night — and a tax
 * whose slab does not cover it is left out. A compound tax is charged on `net` plus the taxes
 * already applied; any other on `net` alone. Every line is rounded half-up to the cent.
 */
export function forwardTaxLines(net: number, taxes: readonly ForwardTax[]): TaxLine[] {
  if (!(net > 0)) return [];
  const ordered = taxes
    .filter((t) => t.rate > 0 && slabCovers(t, net))
    .slice()
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const lines: TaxLine[] = [];
  let before = 0;
  for (const t of ordered) {
    const onBase = t.compound ? net + before : net;
    const amount = roundMoney(onBase * t.rate);
    lines.push({
      key: t.key,
      name: t.name,
      priority: t.priority,
      rate: t.rate,
      amount,
      exemptible: t.exemptible,
      ...(t.code ? { code: t.code } : {}),
      ...(t.displayGroup && t.displayGroup !== 'single' ? { group: t.displayGroup } : {}),
    });
    before = roundMoney(before + amount);
  }
  return lines;
}

/** A night priced forward: the pre-tax price, its taxes, and what the guest pays. */
export function forwardNight(
  net: number,
  taxes: readonly ForwardTax[],
): { net: number; tax: number; selling: number; lines: TaxLine[] } {
  const n = roundMoney(net);
  const lines = forwardTaxLines(n, taxes);
  const tax = sumMoney(lines.map((l) => l.amount));
  return { net: n, tax, selling: roundMoney(n + tax), lines };
}

/**
 * India's GST as it prints: Central GST and State GST, each half the rate, adding up to the GST
 * exactly. The odd cent, if any, goes to CGST.
 */
export function gstHalves(amount: number): { cgst: number; sgst: number } {
  const cgst = roundMoney(amount / 2);
  return { cgst, sgst: roundMoney(amount - cgst) };
}

/**
 * Tax lines as a document shows them: a `gst_split` line becomes its CGST and SGST halves (same
 * key with a suffix, half the rate); every other line is unchanged. The halves add up to the line.
 */
export function displayTaxLines(lines: readonly TaxLine[]): TaxLine[] {
  const out: TaxLine[] = [];
  for (const l of lines) {
    if (l.group !== 'gst_split') {
      out.push(l);
      continue;
    }
    const { cgst, sgst } = gstHalves(l.amount);
    const half = l.rate / 2;
    out.push(
      { ...l, key: `${l.key}:cgst`, name: 'CGST', rate: half, amount: cgst, group: undefined },
      { ...l, key: `${l.key}:sgst`, name: 'SGST', rate: half, amount: sgst, group: undefined },
    );
  }
  return out;
}

/**
 * India's invoice round-off: the grand total to the nearest rupee, and the difference as a line.
 * Half a rupee rounds up.
 */
export function rupeeRoundOff(total: number): { rounded: number; roundOff: number } {
  const rounded = Math.floor(roundMoney(total) + 0.5);
  return { rounded, roundOff: roundMoney(rounded - total) };
}
