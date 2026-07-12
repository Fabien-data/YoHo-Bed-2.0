import { roundUp } from './rounding';
import type { CommissionStructure } from './types';

/**
 * Thrown when a slab-based property has no commission slab covering a given base price.
 * The legacy code would silently return null/0 here; we surface it so migration/ETL catches
 * the gap instead of mispricing.
 */
export class CommissionSlabNotFoundError extends Error {
  constructor(public readonly base: number) {
    super(`No commission slab matches base price ${base}`);
    this.name = 'CommissionSlabNotFoundError';
  }
}

/**
 * The Yoho commission added on top of a room's base price.
 *
 * - `slab`: look up `commissionslabs` where `slab_start <= base <= slab_end`, return its value.
 *   Source: backend Propertymodel::getCommission (`SELECT commission FROM commissionslabs
 *   WHERE slab_start <= ? AND slab_end >= ?`).
 * - `percentage`: gross the base up by the yoho percentage and take the delta.
 *   Source: extranet RatesAndAvailability.php:983
 *   `round_up(($price / (1 - ($commission_percentage / 100))) - $price, 2)`.
 */
export function computeCommission(base: number, structure: CommissionStructure): number {
  if (structure.type === 'percentage') {
    return roundUp(base / (1 - structure.percentage / 100) - base, 2);
  }

  const slab = structure.slabs.find((s) => s.slabStart <= base && base <= s.slabEnd);
  if (!slab) {
    throw new CommissionSlabNotFoundError(base);
  }
  return slab.commission;
}
