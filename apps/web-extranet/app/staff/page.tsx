'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearSession,
  getToken,
  getUser,
  isStaff,
  listStaffTenants,
  getStaffTenantBookings,
  staffBookingAction,
  setTenantStatus,
  getAudit,
  ApiError,
  type AuditEntry,
  type Booking,
  type SessionUser,
  type StaffTenant,
} from '@/lib/api';
import { Button, Card, Logo, Pill } from '@/components/ui';

function money(v?: string | number | null) {
  if (v === undefined || v === null || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isNaN(n)
    ? '—'
    : 'Rs ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function tenantTone(status: StaffTenant['status']): 'avail' | 'low' | 'closed' {
  return status === 'active' ? 'avail' : status === 'inactive' ? 'low' : 'closed';
}
function bookingTone(s: Booking['status']): 'avail' | 'low' | 'closed' | 'muted' {
  if (s === 'Approved') return 'avail';
  if (s === 'Pending') return 'low';
  if (s === 'Rejected' || s === 'Cancelled') return 'closed';
  return 'muted';
}
function ago(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false });
}

export default function StaffPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tenants, setTenants] = useState<StaffTenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (selectId?: string | null) => {
    const [t, a] = await Promise.all([listStaffTenants(), getAudit().catch(() => [])]);
    setTenants(t);
    setAudit(a);
    const next = selectId ?? t[0]?.id ?? null;
    setTenantId(next);
    setBookings(next ? await getStaffTenantBookings(next) : []);
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!getToken()) return void router.replace('/');
    if (!isStaff(u)) return void router.replace('/app');
    setUser(u);
    refresh().catch((e) => {
      if (e instanceof ApiError && e.status === 401) {
        clearSession();
        router.replace('/');
      }
    });
  }, [router, refresh]);

  async function selectTenant(id: string) {
    setTenantId(id);
    setBookings(await getStaffTenantBookings(id));
  }

  async function act(action: 'approve' | 'reject', bookingId: string) {
    if (!tenantId) return;
    setBusy(true);
    try {
      await staffBookingAction(tenantId, bookingId, action);
      await refresh(tenantId);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(t: StaffTenant) {
    setBusy(true);
    try {
      await setTenantStatus(t.id, t.status === 'active' ? 'suspended' : 'active');
      await refresh(tenantId);
    } finally {
      setBusy(false);
    }
  }

  const selected = tenants.find((t) => t.id === tenantId) ?? null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface/90 px-6 py-3 backdrop-blur">
        <Logo />
        <Pill tone="brand">Staff console</Pill>
        <div className="flex-1" />
        {user && <span className="hidden text-sm text-ink-2 sm:inline">{user.email}</span>}
        <Button
          variant="secondary"
          onClick={() => {
            clearSession();
            router.replace('/');
          }}
        >
          Sign out
        </Button>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[320px_1fr]">
        {/* Tenants */}
        <section>
          <div className="mb-2 font-mono text-[0.65rem] uppercase tracking-widest text-ink-3">
            Properties · {tenants.length}
          </div>
          <div className="flex flex-col gap-2">
            {tenants.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer p-3 transition ${tenantId === t.id ? 'border-brand' : ''}`}
              >
                <div onClick={() => selectTenant(t.id)} className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink">{t.name}</div>
                    <div className="font-mono text-xs text-ink-3">{t.email}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={tenantTone(t.status)}>{t.status}</Pill>
                    {t.pending > 0 && <Pill tone="low">{t.pending} pending</Pill>}
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 text-xs"
                    disabled={busy}
                    onClick={() => toggleStatus(t)}
                  >
                    {t.status === 'active' ? 'Suspend' : 'Activate'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Selected tenant bookings + audit */}
        <section className="flex flex-col gap-6">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink">
              {selected ? selected.name : 'Bookings'} — approvals
            </h2>
            <Card className="mt-3 overflow-x-auto">
              {bookings.length === 0 ? (
                <p className="p-6 text-center text-sm text-ink-3">No bookings.</p>
              ) : (
                <table className="w-full text-sm" style={{ minWidth: 640 }}>
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
                      <th className="px-4 py-2 font-medium">Ref</th>
                      <th className="px-4 py-2 font-medium">Guest</th>
                      <th className="px-4 py-2 font-medium">Stay</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 font-mono font-semibold text-brand-ink">{b.reference}</td>
                        <td className="px-4 py-2">{b.customerName}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-2">
                          {b.checkin} → {b.checkout}
                        </td>
                        <td className="px-4 py-2">
                          <Pill tone={bookingTone(b.status)}>{b.status}</Pill>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">{money(b.amount)}</td>
                        <td className="px-4 py-2 text-right">
                          {b.status === 'Pending' && (
                            <div className="flex justify-end gap-1">
                              <Button
                                className="!px-2 !py-1 text-xs"
                                disabled={busy}
                                onClick={() => act('approve', b.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                className="!px-2 !py-1 text-xs"
                                disabled={busy}
                                onClick={() => act('reject', b.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink">Audit trail</h2>
            <Card className="mt-3 p-2">
              {audit.length === 0 ? (
                <p className="p-4 text-center text-sm text-ink-3">No activity yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {audit.slice(0, 12).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-0"
                    >
                      <span className="font-mono text-xs text-ink-3" style={{ minWidth: 140 }}>
                        {ago(a.createdAt)}
                      </span>
                      <Pill tone="muted">{a.action}</Pill>
                      <span className="text-ink-2">{a.actorEmail}</span>
                      <span className="font-mono text-xs text-ink-3">
                        {a.detail ? JSON.stringify(a.detail) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
