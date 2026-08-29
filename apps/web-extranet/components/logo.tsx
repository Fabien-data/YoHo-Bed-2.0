/**
 * The YoHoBed mark: an ink-navy tile carrying a drawn bed, with the brass dot as the
 * "guest light". Pure SVG on tokens, so it follows both themes and prints cleanly.
 */
export function Logo({
  size = 26,
  wordmark = true,
  suffix = 'PMS',
}: {
  size?: number;
  wordmark?: boolean;
  /** The small product label under the name — "PMS", "Extranet", "Staff". */
  suffix?: string;
}) {
  return (
    <span className="inline-flex select-none items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--brand)" />
        <path
          d="M8 21.5v-8a2 2 0 0 1 4 0v3.5h9a3 3 0 0 1 3 3v1.5"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M6.8 24.5h18.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="23.5" cy="10" r="2.6" fill="var(--brass)" />
      </svg>
      {wordmark && (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-ink">YoHoBed</span>
          {suffix && (
            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.22em] text-ink-3">
              {suffix}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
