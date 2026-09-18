/**
 * Money helpers for pricing code written from Development Phase 02 on.
 *
 * The parity core (`rounding.ts`) mirrors the legacy PHP float arithmetic and must never change.
 * New code rounds half-up to the cent instead — never up — and splits totals so that the parts
 * always add back to exactly the whole.
 */

/** Strip binary noise, so 1.005 is treated as 1.005 and not 1.00499999999999989. */
function clean(n: number): number {
  return Number(n.toPrecision(12));
}

/** An amount in whole cents, rounded half away from zero. */
export function toCents(value: number): number {
  const cents = Math.floor(clean(Math.abs(value) * 100) + 0.5);
  return value < 0 ? -cents : cents;
}

/** Round half away from zero to 2 decimals: 1.005 → 1.01, 2.344 → 2.34, −1.005 → −1.01. */
export function roundMoney(value: number): number {
  return toCents(value) / 100;
}

/**
 * Split `total` across `weights` to the cent, so the parts add up to exactly `total`.
 *
 * Largest-remainder method: every part gets its floor, and the cents left over go to the parts
 * whose exact share was cut the most (ties go to the earlier part). Negative weights count as
 * zero; when every weight is zero the total is split evenly.
 */
export function splitProportional(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalCents = toCents(total);
  const sign = totalCents < 0 ? -1 : 1;
  const whole = Math.abs(totalCents);

  const positive = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = positive.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? positive : positive.map(() => 1);
  const shareSum = sum > 0 ? sum : n;

  const exact = shares.map((w) => clean((whole * w) / shareSum));
  const parts = exact.map((x) => Math.floor(x));
  let left = whole - parts.reduce((s, p) => s + p, 0);

  const order = exact
    .map((x, i) => ({ i, rem: x - parts[i]! }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n) {
    parts[order[k]!.i]! += 1;
    left -= 1;
  }

  return parts.map((c) => (sign * c) / 100);
}

/** Sum amounts to the cent without accumulating binary error. */
export function sumMoney(values: number[]): number {
  return values.reduce((s, v) => s + toCents(v), 0) / 100;
}
