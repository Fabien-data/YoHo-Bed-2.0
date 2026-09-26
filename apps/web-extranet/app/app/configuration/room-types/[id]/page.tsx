'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Skeleton } from '@yohobed/ui';
import { useConfigAccess } from '@/components/configuration/config-frame';
import { RoomTypeEditor } from '@/components/configuration/room-type-editor';
import { OwnerOnlyNotice } from '@/components/configuration/shared';

function Editor({ id }: { id: string }) {
  const params = useSearchParams();
  const { canEdit, role, propertyId } = useConfigAccess();
  const mayEdit = canEdit || role === 'CUSTOM';
  if (!propertyId) return <Skeleton className="h-96 w-full" />;
  return (
    <>
      {role !== null && !mayEdit && <OwnerOnlyNotice />}
      <RoomTypeEditor
        key={id}
        propertyId={propertyId}
        roomId={id === 'new' ? null : id}
        canEdit={mayEdit}
        initialTab={params.get('tab')}
      />
    </>
  );
}

/** One room type: `/app/configuration/room-types/new`, or an existing type's id. */
export default function RoomTypePage({ params }: { params: { id: string } }) {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Editor id={params.id} />
    </React.Suspense>
  );
}
