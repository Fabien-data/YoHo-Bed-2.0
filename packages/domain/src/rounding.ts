/**
 * Rounding primitives that reproduce the legacy PHP behaviour exactly.
 *
 * PHP and JavaScript both use IEEE-754 doubles, so mirroring the *same sequence* of float
 * operations yields identical results. This is intentional: parity with the legacy stored
 * numbers is the requirement, so we do NOT switch to decimal/integer-cents math in the
 * pricing path (that would change outputs).
 */

/**
 * Legacy `round_up` — always ceilings, never banker's/half-up rounding.
 * Source: extranet/app/Http/Controllers/RatesAndAvailability.php:1238-1242
 *   `return ceil($value * pow(10, $places)) / pow(10, $places);`
 */
export function roundUp(value: number, places = 2): number {
  const factor = Math.pow(10, places);
  return Math.ceil(value * factor) / factor;
}

/**
 * PHP `round()` — half away from zero. For non-negative monetary values this matches
 * `Math.round`. Used by the tax decomposition (PricingCalculator.php:61 `round(...)`).
 */
export function round2(value: number, places = 2): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}
