'use client';

import { CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';

/**
 * A section's tick (owner brief, 2026-09-26: "ID Doc and guest information need to have tick"):
 * a green check once the section has what the desk needs, otherwise what is still missing. Text
 * as well as the icon, because a tick alone would be colour-and-shape only.
 *
 * `required` turns a missing section amber — the hotel will not check the guest in without it.
 */
export function SectionTick({
  done,
  doneLabel = 'Complete',
  todo,
  required,
  hint,
  className,
}: {
  done: boolean;
  doneLabel?: string;
  /** What is missing, in a few words ("phone or email, nationality"). */
  todo: string;
  required?: boolean;
  /** A longer word on it, on hover. */
  hint?: string;
  className?: string;
}) {
  const chip = (
    <span
      data-section-done={done}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        done
          ? 'bg-avail-soft text-avail-ink'
          : required
            ? 'bg-low-soft text-low-ink'
            : 'bg-surface-2 text-ink-3',
        className,
      )}
    >
      {done ? (
        <CheckCircle size={13} weight="fill" aria-hidden />
      ) : required ? (
        <WarningCircle size={13} weight="bold" aria-hidden />
      ) : (
        <Circle size={13} aria-hidden />
      )}
      {done ? doneLabel : todo}
    </span>
  );
  return hint ? <Tooltip label={hint}>{chip}</Tooltip> : chip;
}
