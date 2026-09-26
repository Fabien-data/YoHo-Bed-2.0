import { redirect } from 'next/navigation';
import { LEGACY_TABS } from '@/components/configuration/legacy-tabs';

/**
 * Configuration opens on the Hotel profile. An old `?tab=` link (the tabbed "Reservation setup"
 * before 2026-09-26) goes to the section that tab became.
 */
export default function ConfigurationIndex({
  searchParams,
}: {
  searchParams: { tab?: string | string[] };
}) {
  const tab = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  redirect(`/app/configuration/${(tab && LEGACY_TABS[tab]) || 'profile'}`);
}
