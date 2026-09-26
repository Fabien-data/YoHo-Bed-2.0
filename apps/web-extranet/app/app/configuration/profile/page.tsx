'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@yohobed/ui';
import { useActiveProperty } from '@/components/active-property';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import {
  AddPropertyButton,
  HotelProfile,
  PROFILE_TABS,
  type ProfileTab,
} from '@/components/configuration/hotel-profile';

function Profile() {
  const params = useSearchParams();
  const { canEdit, property } = useConfigAccess();
  const { switchProperty } = useActiveProperty();
  const asked = params.get('tab');
  const tab: ProfileTab = (PROFILE_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as ProfileTab)
    : 'profile';
  return (
    <ConfigPage
      slug="profile"
      actions={canEdit ? <AddPropertyButton onAdded={(p) => switchProperty(p.id)} /> : undefined}
    >
      {property ? (
        <HotelProfile property={property} canEdit={canEdit} tab={tab} />
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
    </ConfigPage>
  );
}

/** Configuration → Hotel profile: Profile, Highlights, Amenities, Photo gallery and Policies. */
export default function HotelProfilePage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Profile />
    </React.Suspense>
  );
}
