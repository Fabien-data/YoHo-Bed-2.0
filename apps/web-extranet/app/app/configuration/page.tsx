'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobeHemisphereEast } from '@phosphor-icons/react';
import { countryName } from '@yohobed/locale';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@yohobed/ui';
import { applyCountryPreset } from '@/lib/api';
import { queryKeys, useTenantRole } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { PropertyProfileForm } from '@/components/configuration/property-profile-form';
import { ReservationSettingsForm } from '@/components/configuration/reservation-settings-form';
import { BusinessSourcesTab } from '@/components/configuration/business-sources-tab';
import { MarketSegmentsTab } from '@/components/configuration/market-segments-tab';
import { PaymentMethodsTab } from '@/components/configuration/payment-methods-tab';
import { SalesPersonsTab } from '@/components/configuration/sales-persons-tab';
import { OwnerOnlyNotice, errorMessage } from '@/components/configuration/shared';

const TABS = [
  { value: 'property', label: 'Property profile' },
  { value: 'reservations', label: 'Reservation settings' },
  { value: 'sources', label: 'Business sources' },
  { value: 'segments', label: 'Market segments' },
  { value: 'payments', label: 'Payment methods' },
  { value: 'sales', label: 'Sales persons' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

const PRESET_COUNTRIES = ['LK', 'MY', 'IN'] as const;

function isTab(v: string | null): v is TabValue {
  return TABS.some((t) => t.value === v);
}

/**
 * Yanolja's Configuration for the reservation desk: the property's identity and settings, and
 * the lists every reservation picks from. Everyone can read it; only the owner can change it.
 */
function ConfigurationScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const role = useTenantRole();
  const canEdit = role === 'OWNER';
  const { property, properties } = useActiveProperty();

  const requested = params.get('tab');
  const tab: TabValue = isTab(requested) ? requested : 'property';
  const setTab = (v: string) => router.replace(`${pathname}?tab=${v}`, { scroll: false });

  const preset = useMutation({
    mutationFn: (country: (typeof PRESET_COUNTRIES)[number]) => applyCountryPreset(country),
    onSuccess: (added, country) => {
      const total = added.businessSources + added.marketSegments + added.paymentMethods;
      toast.success(
        total === 0
          ? `Nothing new — you already have everything in the ${countryName(country)} preset`
          : `Added ${added.businessSources} sources, ${added.marketSegments} segments and ${added.paymentMethods} payment methods`,
      );
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Reservation setup"
        description="The property's identity and the lists every reservation uses — where guests come from, why they stay, and how they pay."
        actions={
          canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" loading={preset.isPending}>
                  <GlobeHemisphereEast size={16} />
                  Add a country preset
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>Adds only what is missing</MenuLabel>
                {PRESET_COUNTRIES.map((c) => (
                  <MenuItem key={c} onSelect={() => preset.mutate(c)}>
                    {countryName(c)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )
        }
      />

      {role !== null && !canEdit && <OwnerOnlyNotice />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="property">
          {property ? (
            <PropertyProfileForm property={property} canEdit={canEdit} />
          ) : (
            <Skeleton className="h-96 w-full" />
          )}
        </TabsContent>
        <TabsContent value="reservations">
          {property && <ReservationSettingsForm propertyId={property.id} canEdit={canEdit} />}
        </TabsContent>
        <TabsContent value="sources">
          <BusinessSourcesTab canEdit={canEdit} countryCode={property?.countryCode} />
        </TabsContent>
        <TabsContent value="segments">
          <MarketSegmentsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentMethodsTab canEdit={canEdit} properties={properties ?? []} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesPersonsTab canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ConfigurationPage() {
  // useSearchParams needs a Suspense boundary for Next's static rendering pass.
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ConfigurationScreen />
    </React.Suspense>
  );
}
