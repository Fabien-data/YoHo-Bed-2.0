'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobeHemisphereEast } from '@phosphor-icons/react';
import { countryName } from '@yohobed/locale';
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, toast } from '@yohobed/ui';
import { applyCountryPreset } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { BusinessSourcesTab } from '@/components/configuration/business-sources-tab';
import { errorMessage } from '@/components/configuration/shared';

const PRESET_COUNTRIES = ['LK', 'MY', 'IN'] as const;

export default function BusinessSourcesPage() {
  const qc = useQueryClient();
  const { canEdit, property } = useConfigAccess();
  // A country preset adds the sources, segments and payment methods a market expects.
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
    <ConfigPage
      slug="business-sources"
      actions={
        canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" loading={preset.isPending}>
                <GlobeHemisphereEast size={16} aria-hidden />
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
    >
      <BusinessSourcesTab canEdit={canEdit} countryCode={property?.countryCode} />
    </ConfigPage>
  );
}
