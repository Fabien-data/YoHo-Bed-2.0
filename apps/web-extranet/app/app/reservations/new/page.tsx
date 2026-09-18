'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@yohobed/ui';
import { AddReservation } from '@/components/reservations/full/add-reservation';
import type { Prefill } from '@/components/reservations/composer/draft';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function AddReservationScreen() {
  const params = useSearchParams();
  // A prefill from the URL: Stay View, Room View, or a bookmark. Anything malformed is ignored.
  const prefill = React.useMemo<Prefill | null>(() => {
    const checkin = params.get('checkin');
    const nights = Number(params.get('nights'));
    const roomId = params.get('roomId');
    const roomUnitId = params.get('roomUnitId');
    const p: Prefill = {
      ...(checkin && ISO.test(checkin) ? { checkin } : {}),
      ...(Number.isInteger(nights) && nights > 0 && nights <= 90 ? { nights } : {}),
      ...(roomId ? { roomId } : {}),
      ...(roomUnitId ? { roomUnitId } : {}),
    };
    return Object.keys(p).length ? p : null;
  }, [params]);
  return <AddReservation prefill={prefill} />;
}

export default function AddReservationPage() {
  // useSearchParams needs a Suspense boundary for Next's static rendering pass.
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AddReservationScreen />
    </React.Suspense>
  );
}
