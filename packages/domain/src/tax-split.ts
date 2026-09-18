import { splitProportional, toCents } from './money';

/**
 * One tax a property charges on a date — a `tax_types` row at its priority slot.
 *
 * The legacy engine (`taxFromSelling`) only knows three summed slots: service charge (1), the
 * second slot that was NBT and is now SSCL in Sri Lanka (2), and VAT (3). Components keep the
 * names and flags the slots lose, so a bill and an invoice can show each tax on its own line.
 */
export interface TaxComponent {
  /** Stable key for the line — the tax type id. */
  key: string;
  name: string;
  priority: number;
  /** Decimal fraction: 0.18 = 18%. */
  rate: number;
  /** Whether a tax-exempt guest (an embassy, say) is excused from it. */
  exemptible: boolean;
}

export interface TaxLine {
  key: string;
  name: string;
  priority: number;
  rate: number;
  amount: number;
  exemptible: boolean;
}

/**
 * Split the tax the legacy engine decomposed out of a tax-inclusive price into one line per tax.
 *
 * `totalTax` is the stored figure (`taxFromSelling(selling, …)`), and the lines always add up to
 * it exactly: each tax's share is computed with the same compounding the engine uses (service
 * charge on the net, the second slot on net + service charge, VAT on all of it), then the cents
 * are apportioned with the largest-remainder method. Several taxes in one slot share that slot's
 * amount in proportion to their rates.
 */
export function splitInclusiveTax(
  selling: number,
  components: TaxComponent[],
  totalTax: number,
): TaxLine[] {
  const live = components.filter((c) => c.rate > 0 && c.priority >= 1 && c.priority <= 3);
  if (live.length === 0 || toCents(totalTax) === 0) return [];

  const slot = (p: number) => live.filter((c) => c.priority === p).reduce((s, c) => s + c.rate, 0);
  const sc = slot(1);
  const second = slot(2);
  const vat = slot(3);

  const net = selling / (1 + vat) / (1 + second) / (1 + sc);
  const slotAmount: Record<number, number> = {
    1: net * sc,
    2: net * (1 + sc) * second,
    3: net * (1 + sc) * (1 + second) * vat,
  };
  const slotRate: Record<number, number> = { 1: sc, 2: second, 3: vat };

  const exact = live.map((c) => (slotAmount[c.priority]! * c.rate) / slotRate[c.priority]!);
  const amounts = splitProportional(totalTax, exact);

  return live.map((c, i) => ({
    key: c.key,
    name: c.name,
    priority: c.priority,
    rate: c.rate,
    amount: amounts[i]!,
    exemptible: c.exemptible,
  }));
}
