'use client';

import {
  Bed,
  Broom,
  CheckCircle,
  ClockCountdown,
  Globe,
  Handshake,
  Hourglass,
  Lock,
  Prohibit,
  Question,
  SealCheck,
  SignOut,
  Sparkle,
  Storefront,
  UserMinus,
  Wrench,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { StayBar } from '@/lib/api';
import type { Housekeeping, StayState } from './model/status';

/** One icon per state — the shape that makes a state readable without its colour. */
export const STATE_ICON: Record<StayState, Icon> = {
  inhouse: Bed,
  confirmed: CheckCircle,
  pending: Hourglass,
  hold: ClockCountdown,
  tentative: Question,
  checkedout: SignOut,
  noshow: UserMinus,
  cancelled: XCircle,
  out_of_service: Wrench,
  blocked: Lock,
};

export const HK_ICON: Record<Housekeeping, Icon> = {
  clean: Sparkle,
  dirty: Broom,
  inspected: SealCheck,
  out_of_order: Prohibit,
};

/** Where a booking came from, as a small secondary mark. */
export function sourceIcon(bar: Pick<StayBar, 'source' | 'channel'>): Icon {
  if (bar.source === 'OTA' || bar.channel) return Globe;
  if (bar.source === 'Backend') return Handshake;
  return Storefront;
}
