/**
 * The pulse survey's statements (UX-0). They are the Cloudbeds/NYU "Hotel PMS User Experience"
 * report's own survey items (2025, 500 hotel employees in the US, Canada, Mexico, the UK and
 * Spain), reworded only to name the product, so our scores compare directly with theirs.
 *
 * `baselinePct` is the share agreeing in that report — the unweighted mean of its five country
 * figures. It is the industry bar the staff scoreboard shows us beside our own number.
 */
export const SURVEY_ITEMS = [
  {
    key: 'easy_to_use',
    text: 'YoHoBed is easy to use.',
    // UK 90, US 92, CA 80, MX 80, ES 83
    baselinePct: 85.0,
  },
  {
    key: 'easy_to_learn',
    text: 'Learning to use YoHoBed was easy.',
    // UK 66, US 75, CA 84, MX 66, ES 56 — the report's weakest item.
    baselinePct: 69.4,
  },
  {
    key: 'faster',
    text: 'YoHoBed helps me complete my tasks faster.',
    // UK 91, US 90, CA 88, MX 78, ES 90
    baselinePct: 87.4,
  },
  {
    key: 'fewer_mistakes',
    text: 'YoHoBed helps me make fewer mistakes in my work.',
    // UK 81, US 84, CA 70, MX 75, ES 80
    baselinePct: 78.0,
  },
] as const;

export type SurveyItemKey = (typeof SURVEY_ITEMS)[number]['key'];
export const SURVEY_KEYS = SURVEY_ITEMS.map((i) => i.key) as [SurveyItemKey, ...SurveyItemKey[]];

/** Nobody is asked before they've had time to form a view. */
export const SURVEY_MIN_TENURE_DAYS = 14;
/** At most once a quarter per person. */
export const SURVEY_INTERVAL_DAYS = 90;
/** "Not now" is respected for two weeks. */
export const SURVEY_SNOOZE_DAYS = 14;
