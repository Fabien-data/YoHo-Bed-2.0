'use client';

import * as React from 'react';
import { LockSimple } from '@phosphor-icons/react';
import { Badge } from '@yohobed/ui';
import { ApiError } from '@/lib/api';
import type {
  CommissionPlan,
  MarketSegmentGroup,
  PaymentCategory,
  SourceCategory,
} from '@/lib/api';

/** Radix Select forbids an empty value, so "nothing chosen" travels as this sentinel. */
export const NONE = '__none';

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  direct: 'Direct',
  ota: 'OTA',
  travel_agent: 'Travel agent',
  corporate: 'Corporate',
};

export const SEGMENT_GROUP_LABELS: Record<MarketSegmentGroup, string> = {
  transient: 'Transient',
  group: 'Group',
  contract: 'Contract',
  non_revenue: 'Non-revenue',
};

export const PAYMENT_CATEGORY_LABELS: Record<PaymentCategory, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  qr: 'QR payment',
  wallet: 'E-wallet',
  cheque: 'Cheque / draft',
  city_ledger: 'City ledger',
  online: 'Online banking',
  other: 'Other',
};

/** What an expense is reported under (Configuration → Payouts, Cashiering → Expenses). */
export const PAYOUT_CATEGORY: Record<
  'supplies' | 'maintenance' | 'transport' | 'staff' | 'utilities' | 'other',
  string
> = {
  supplies: 'Supplies',
  maintenance: 'Maintenance',
  transport: 'Transport',
  staff: 'Staff',
  utilities: 'Utilities',
  other: 'Other',
};

export const COMMISSION_PLAN_LABELS: Record<CommissionPlan, string> = {
  none: 'No commission',
  pct_all_nights: '% of every night',
  pct_first_night: '% of the first night',
  fixed_per_night: 'Fixed amount per night',
  fixed_per_stay: 'Fixed amount per stay',
};

/** Shown above an editable screen when the signed-in user may only read it. */
export function OwnerOnlyNotice() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink">
      <LockSimple size={16} className="shrink-0" />
      Only the property owner can change these settings. You can view them.
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="avail">Active</Badge> : <Badge tone="muted">Inactive</Badge>;
}

/** The message to show for a failed save. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const data = e.data as { errors?: { fieldErrors?: Record<string, string[]> } } | undefined;
    const first = data?.errors?.fieldErrors && Object.values(data.errors.fieldErrors)[0]?.[0];
    return first ? `${e.message}: ${first}` : e.message;
  }
  return 'Something went wrong';
}

/** A labelled switch row for settings forms. */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // A control too wide to sit beside the text on a phone wraps under it; a switch stays inline.
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line py-3 last:border-0">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && <div className="mt-0.5 text-xs text-ink-3">{description}</div>}
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}
