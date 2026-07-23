'use client';

import { usePathname } from 'next/navigation';
import { activeSection } from '@/lib/sections';

/**
 * Testing-phase footer: links the current section to its public feature guide
 * (a Notion page explaining the feature + backend logic, with a feedback form).
 * Hidden until the section's real docs URL is wired into lib/sections.ts.
 */
export function FeatureDocsLink() {
  const pathname = usePathname();
  const section = activeSection(pathname);
  if (!section || section.docsUrl.includes('PLACEHOLDER')) return null;

  return (
    <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-3">
      Testing this section?{' '}
      <a
        href={section.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-ink hover:underline"
      >
        Read the {section.label} feature guide &amp; leave feedback →
      </a>
    </footer>
  );
}
