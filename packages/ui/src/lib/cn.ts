import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones in the same group.
 *
 * Without `twMerge`, `cn('px-4', 'px-2')` would emit both and the winner would depend on
 * stylesheet order — which is how variant props silently stop working. This is the single
 * composition primitive every component in this package uses.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
