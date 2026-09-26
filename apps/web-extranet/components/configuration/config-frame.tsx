'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MagicWand } from '@phosphor-icons/react';
import {
  PageHeader,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@yohobed/ui';
import { useTenantRole } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { CONFIG_GROUPS, CONFIG_SECTIONS, sectionOf, type ConfigSection } from './sections';
import { OwnerOnlyNotice } from './shared';

/** A hotel-created role with the `setup` permission works on its room types, not the rest. */
export const CUSTOM_ROLE_SECTIONS = new Set(['room-types']);

function visibleSections(role: string | null): ConfigSection[] {
  return role === 'CUSTOM'
    ? CONFIG_SECTIONS.filter((s) => CUSTOM_ROLE_SECTIONS.has(s.slug))
    : CONFIG_SECTIONS;
}

/**
 * Configuration's side navigation — Yanolja's building and gear menus as one grouped list.
 * Below `lg` it becomes a section picker, so a phone never loses half its width to it.
 */
export function ConfigNav({ current }: { current: string }) {
  const router = useRouter();
  const role = useTenantRole();
  const sections = visibleSections(role);
  const groups = CONFIG_GROUPS.map((g) => ({
    ...g,
    items: sections.filter((s) => s.group === g.key),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="lg:hidden">
        <Select value={current} onValueChange={(slug) => router.push(`/app/configuration/${slug}`)}>
          <SelectTrigger aria-label="Configuration section" className="w-full">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectGroup key={g.key}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  {g.label}
                </div>
                {g.items.map((s) => (
                  <SelectItem key={s.slug} value={s.slug}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label="Configuration sections"
        className="hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto"
      >
        {groups.map((g) => (
          <div key={g.key} className="mb-4">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              {g.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((s) => {
                const active = s.slug === current;
                const Icon = s.icon;
                return (
                  <li key={s.slug}>
                    <Link
                      href={`/app/configuration/${s.slug}`}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition duration-1',
                        active
                          ? 'bg-brand-soft font-semibold text-brand-ink'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brass"
                        />
                      )}
                      <Icon
                        size={16}
                        weight={active ? 'duotone' : 'regular'}
                        className="shrink-0"
                      />
                      {s.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {role === 'OWNER' && (
          <Link
            href="/app/setup/smart"
            className="mx-3 mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand-ink hover:underline"
          >
            <MagicWand size={13} aria-hidden /> Guided pricing setup
          </Link>
        )}
      </nav>
    </>
  );
}

/** Who may change configuration, and the property it applies to. */
export function useConfigAccess() {
  const role = useTenantRole();
  const { property, properties, propertyId } = useActiveProperty();
  return { role, canEdit: role === 'OWNER', property, properties, propertyId };
}

/**
 * One configuration section's page: its title from the registry, what it is for, the owner-only
 * notice for everyone else, and its content.
 */
export function ConfigPage({
  slug,
  actions,
  children,
}: {
  slug: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const section = sectionOf(slug);
  const { role, canEdit } = useConfigAccess();
  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title={section?.label ?? 'Configuration'}
        description={section?.description}
        actions={actions}
      />
      {role !== null && !canEdit && role !== 'CUSTOM' && <OwnerOnlyNotice />}
      {children}
    </div>
  );
}
