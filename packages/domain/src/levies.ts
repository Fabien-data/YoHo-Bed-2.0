import { roundMoney } from './money';
import type { Residency } from './residency';

/**
 * Levies (Development Phase 02, Sprint 7): a fixed charge per room per night that is not a tax on
 * the price — Malaysia's Tourism Tax (TTx), RM10 per room per night for foreign guests.
 *
 * The rules, from the Tourism Tax Act 2017 guidance:
 * - charged for nights ACTUALLY stayed — complimentary nights included, no-show nights never;
 * - foreign guests only (citizens and permanent residents are exempt);
 * - never charged twice: not when the booking channel collected it, not on an exempt stay;
 * - shown on its own line, never inside the room price, and never split across invoices.
 *
 * A levy is a folio line of its own (`source = 'levy'`), so the room charges still add up to the
 * booking amount. It is not room revenue.
 */

export const LEVY_BASES = ['per_room_per_night'] as const;
export type LevyBasis = (typeof LEVY_BASES)[number];

export const LEVY_AUDIENCES = ['non_resident', 'all'] as const;
export type LevyAudience = (typeof LEVY_AUDIENCES)[number];

export interface Levy {
  code: string;
  name: string;
  /** Per unit of the basis, in the levy's currency. */
  amount: number;
  currency: string;
  basis: LevyBasis;
  appliesTo: LevyAudience;
  /** Inclusive; null = open-ended. */
  validFrom: string | null;
  validTo: string | null;
  /** The operator's registration number printed beside the line (Malaysia's TTx number). */
  registrationNo?: string | null;
}

export interface LevyStay {
  residency: Residency | null;
  levyExempt: boolean;
  collectedByChannel: boolean;
  rooms: number;
}

/** Why a stay is not charged a levy, or null when it is. */
export function levyExemption(
  levy: Pick<Levy, 'appliesTo'>,
  stay: LevyStay,
): 'exempt' | 'collected_by_channel' | 'resident' | 'residency_unknown' | null {
  if (stay.levyExempt) return 'exempt';
  if (stay.collectedByChannel) return 'collected_by_channel';
  if (levy.appliesTo === 'non_resident') {
    if (stay.residency === 'local') return 'resident';
    if (stay.residency !== 'foreign') return 'residency_unknown';
  }
  return null;
}

/** Whether a levy is in force on a night. */
export function levyInForce(levy: Pick<Levy, 'validFrom' | 'validTo'>, date: string): boolean {
  return (!levy.validFrom || levy.validFrom <= date) && (!levy.validTo || levy.validTo >= date);
}

/** The levy for one night of the stay, for all its rooms. Zero when the stay is not charged. */
export function levyForNight(levy: Levy, stay: LevyStay, date: string): number {
  if (levyExemption(levy, stay) !== null || !levyInForce(levy, date)) return 0;
  return roundMoney(levy.amount * stay.rooms);
}
