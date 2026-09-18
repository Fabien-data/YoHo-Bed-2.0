/**
 * Meal-plan codes as the front desk expects to read them.
 *
 * YoHoBed stores the international board codes (RO/BB/HB/FB/AI). Indian hotels and Indian OTAs
 * (MakeMyTrip, Goibibo) use the American-plan codes for exactly the same four plans, so a property
 * can choose which set its screens show. Storage never changes — only the label does.
 */

export const MEAL_CODE_STYLES = ['international', 'indian'] as const;
export type MealCodeStyle = (typeof MEAL_CODE_STYLES)[number];

const INDIAN: Record<string, { code: string; name: string }> = {
  RO: { code: 'EP', name: 'European Plan (room only)' },
  BB: { code: 'CP', name: 'Continental Plan (breakfast)' },
  HB: { code: 'MAP', name: 'Modified American Plan (breakfast + one meal)' },
  FB: { code: 'AP', name: 'American Plan (all meals)' },
  AI: { code: 'AI', name: 'All Inclusive' },
};

/** The code to show for a stored board code, in the property's chosen style. */
export function displayMealCode(code: string, style: MealCodeStyle = 'international'): string {
  if (style === 'indian') return INDIAN[code]?.code ?? code;
  return code;
}

/** The long label for a stored board code in the chosen style, or null to keep the stored name. */
export function displayMealName(
  code: string,
  style: MealCodeStyle = 'international',
): string | null {
  if (style === 'indian') return INDIAN[code]?.name ?? null;
  return null;
}
