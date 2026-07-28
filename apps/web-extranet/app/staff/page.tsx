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
  getStaffTenantProperties,
  setPropertyCurrency,
  ApiError,
  type AuditEntry,
  type Booking,
  type SessionUser,
  type StaffTenant,
  type StaffProperty,
} from '@/lib/api';
import { Button, Card, Logo, Pill } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';
import { money } from '@/lib/format';

function tenantTone(status: StaffTenant['status']): 'avail' | 'low' | 'closed' {
  return status === 'active' ? 'avail' : status === 'pending' ? 'low' : 'closed';
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
  const [properties, setProperties] = useState<StaffProperty[]>([]);
  const [ccyError, setCcyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (selectId?: string | null) => {
    const [t, a] = await Promise.all([listStaffTenants(), getAudit().catch(() => [])]);
    setTenants(t);
    setAudit(a);
    const next = selectId ?? t[0]?.id ?? null;
    setTenantId(next);
    setBookings(next ? await getStaffTenantBookings(next) : []);
    setProperties(next ? await getStaffTenantProperties(next).catch(() => []) : []);
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
    setCcyError(null);
    setBookings(await getStaffTenantBookings(id));
    setProperties(await getStaffTenantProperties(id).catch(() => []));
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

  /** Approve a self-registered owner (pending → active). Sends the welcome email server-side. */
  async function approveTenant(t: StaffTenant) {
    setBusy(true);
    try {
      await setTenantStatus(t.id, 'active');
      await refresh(tenantId);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Base currency is set here rather than by the owner: it decides the denomination of settlement
   * and has to match the payee bank account, which only staff can verify. The server refuses the
   * change once the property has bookings; `locked` mirrors that rule so the control disables
   * instead of offering an action that will fail.
   */
  async function changeCurrency(p: StaffProperty, currency: 'LKR' | 'USD') {
    if (!tenantId || p.locked || p.currency === currency) return;
    setBusy(true);
    setCcyError(null);
    try {
      await setPropertyCurrency(tenantId, p.id, currency);
      setProperties(await getStaffTenantProperties(tenantId));
      setAudit(await getAudit().catch(() => []));
    } catch (e) {
      setCcyError(e instanceof ApiError ? e.message : 'Could not change the base currency.');
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
        <ThemeToggle />
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
                <div
                  onClick={() => selectTenant(t.id)}
                  className="flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold text-ink">{t.name}</div>
                    <div className="font-mono text-xs text-ink-3">{t.email}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={tenantTone(t.status)}>{t.status}</Pill>
                    {t.pending > 0 && <Pill tone="low">{t.pending} pending</Pill>}
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  {t.status === 'pending' && (
                    <Button
                      className="!px-2 !py-1 text-xs"
                      disabled={busy}
                      onClick={() => approveTenant(t)}
                    >
                      Approve
                    </Button>
                  )}
                  {t.status !== 'pending' && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 text-xs"
                      disabled={busy}
                      onClick={() => toggleStatus(t)}
                    >
                      {t.status === 'active' ? 'Suspend' : 'Activate'}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Selected tenant bookings + audit */}
        <section className="flex flex-col gap-6">
          {selected && properties.length > 0 && (
            <div>
              <h2 className="text-lg font-bold tracking-tight text-ink">
                {selected.name} — base currency
              </h2>
              <p className="mt-1 text-xs text-ink-3">
                The currency each property prices and settles in. It must match the payee bank
                account, and locks permanently once the property has bookings — their amounts are
                recorded in it, so a change would reinterpret history rather than convert it.
              </p>
              {ccyError && (
                <p className="mt-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-2">
                  {ccyError}
                </p>
              )}
              <Card className="mt-3 divide-y divide-line">
                {properties.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{p.name}</div>
                      <div className="font-mono text-[0.65rem] text-ink-3">
                        {p.locked
                          ? `locked · ${p.bookings} booking${p.bookings === 1 ? '' : 's'} in ${p.currency}`
                          : 'no bookings yet · editable'}
                      </div>
                    </div>
                    {p.locked ? (
                      <Pill tone="muted">{p.currency}</Pill>
                    ) : (
                      <select
                        value={p.currency}
                        disabled={busy}
                        onChange={(e) => changeCurrency(p, e.target.value as 'LKR' | 'USD')}
                        aria-label={`Base currency for ${p.name}`}
                        className="rounded-lg border border-line bg-[var(--surface-2)] px-2 py-1.5 text-sm font-semibold text-ink-2"
                      >
                        <option value="LKR">LKR</option>
                        <option value="USD">USD</option>
                      </select>
                    )}
                  </div>
                ))}
              </Card>
            </div>
          )}

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
                        <td className="px-4 py-2 font-mono font-semibold text-brand-ink">
                          {b.reference}
                        </td>
                        <td className="px-4 py-2">{b.customerName}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-2">
                          {b.checkin} → {b.checkout}
                        </td>
                        <td className="px-4 py-2">
                          <Pill tone={bookingTone(b.status)}>{b.status}</Pill>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">
                          {money(b.amount, b.currency)}
                        </td>
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
