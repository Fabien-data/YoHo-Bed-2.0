'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listProperties,
  listPromotions,
  createPromotion,
  applyPromotion,
  deletePromotion,
  listCoupons,
  createCoupon,
  deleteCoupon,
  listReferralPartners,
  createReferralPartner,
  deleteReferralPartner,
  listReferralCommissions,
  ApiError,
  type Property,
  type Promotion,
  type Coupon,
  type ReferralPartner,
  type ReferralCommission,
} from '@/lib/api';
import { Button, Card, Field, Pill } from '@/components/ui';
import { money } from '@/lib/format';

const selectClass =
  'rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

export default function DealsPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [partners, setPartners] = useState<ReferralPartner[]>([]);
  const [commissions, setCommissions] = useState<ReferralCommission[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  const [promoForm, setPromoForm] = useState({
    name: '',
    discountPct: 15,
    from: '2026-08-01',
    to: '2026-08-31',
    minNights: 1,
  });
  const [couponForm, setCouponForm] = useState({
    code: '',
    type: 'percentage' as 'percentage' | 'fixed',
    value: 10,
    from: '2026-08-01',
    to: '2026-12-31',
    maxUses: 0,
  });
  const [partnerForm, setPartnerForm] = useState({ name: '', code: '', commissionPct: 5 });

  const loadCommon = useCallback(async () => {
    const [c, p, com] = await Promise.all([
      listCoupons().catch(() => []),
      listReferralPartners().catch(() => []),
      listReferralCommissions().catch(() => []),
    ]);
    setCoupons(c);
    setPartners(p);
    setCommissions(com);
  }, []);
  const loadPromos = useCallback(
    async (pid: string) => setPromotions(pid ? await listPromotions(pid).catch(() => []) : []),
    [],
  );

  useEffect(() => {
    (async () => {
      const props = await listProperties();
      setProperties(props);
      const pid = props[0]?.id ?? '';
      setPropertyId(pid);
      await Promise.all([loadPromos(pid), loadCommon()]);
    })().catch(() => {});
  }, [loadPromos, loadCommon]);

  async function selectProperty(pid: string) {
    setPropertyId(pid);
    await loadPromos(pid);
  }

  async function guard(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'avail', text: ok });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  const addPromo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId || !promoForm.name.trim()) return;
    return guard(async () => {
      await createPromotion(propertyId, { ...promoForm, name: promoForm.name.trim() });
      setPromoForm((f) => ({ ...f, name: '' }));
      await loadPromos(propertyId);
    }, 'Promotion created.');
  };
  const applyPromo = (id: string, name: string) =>
    guard(async () => {
      const res = await applyPromotion(id);
      setMsg({
        tone: 'avail',
        text: `Applied “${name}” to ${res.ratesUpdated} rate rows on the calendar.`,
      });
    });
  const delPromo = (id: string) =>
    guard(async () => {
      await deletePromotion(id);
      await loadPromos(propertyId);
    });

  const addCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.code.trim()) return;
    return guard(async () => {
      await createCoupon({ ...couponForm, code: couponForm.code.trim() });
      setCouponForm((f) => ({ ...f, code: '' }));
      await loadCommon();
    }, 'Coupon created.');
  };
  const delCoupon = (id: string) =>
    guard(async () => {
      await deleteCoupon(id);
      await loadCommon();
    });

  const addPartner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerForm.name.trim() || !partnerForm.code.trim()) return;
    return guard(async () => {
      await createReferralPartner({
        ...partnerForm,
        name: partnerForm.name.trim(),
        code: partnerForm.code.trim(),
      });
      setPartnerForm({ name: '', code: '', commissionPct: 5 });
      await loadCommon();
    }, 'Referral partner created.');
  };
  const delPartner = (id: string) =>
    guard(async () => {
      await deleteReferralPartner(id);
      await loadCommon();
    });

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Commercial
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Deals &amp; codes</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-2">
        Promotions push a discount onto the rate calendar; coupons are guest codes redeemed at
        booking; referral partners earn a commission on the bookings they bring.
      </p>

      {msg && (
        <div
          className="mt-5 rounded-xl px-4 py-3 text-sm font-semibold"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Promotions */}
      <section className="mt-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">Promotions</h2>
          <select
            className={selectClass}
            value={propertyId}
            onChange={(e) => selectProperty(e.target.value)}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Card className="mt-3 p-5">
          <form onSubmit={addPromo} className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <Field
                label="Name"
                value={promoForm.name}
                onChange={(e) => setPromoForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Monsoon Special"
              />
            </div>
            <div className="w-24">
              <Field
                label="Discount %"
                type="number"
                min={0}
                max={90}
                value={promoForm.discountPct}
                onChange={(e) =>
                  setPromoForm((f) => ({ ...f, discountPct: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div className="w-40">
              <Field
                label="From"
                type="date"
                value={promoForm.from}
                onChange={(e) => setPromoForm((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="w-40">
              <Field
                label="To"
                type="date"
                value={promoForm.to}
                onChange={(e) => setPromoForm((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <div className="w-24">
              <Field
                label="Min nights"
                type="number"
                min={1}
                value={promoForm.minNights}
                onChange={(e) =>
                  setPromoForm((f) => ({ ...f, minNights: Number(e.target.value) || 1 }))
                }
              />
            </div>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>

          <div className="mt-4 flex flex-col gap-2">
            {promotions.length === 0 && <p className="text-sm text-ink-3">No promotions yet.</p>}
            {promotions.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-line px-4 py-3"
              >
                <span className="font-semibold text-ink">{p.name}</span>
                <Pill tone="low">−{Number(p.discountPct)}%</Pill>
                <span className="font-mono text-xs text-ink-3">
                  {p.startDate} → {p.endDate} · min {p.minNights}n
                </span>
                <div className="flex-1" />
                <Button
                  className="!px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => applyPromo(p.id, p.name)}
                >
                  Apply to calendar
                </Button>
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => delPromo(p.id)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Coupons */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink">Coupons</h2>
        <Card className="mt-3 p-5">
          <form onSubmit={addCoupon} className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field
                label="Code"
                value={couponForm.code}
                onChange={(e) =>
                  setCouponForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="SUMMER10"
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Type</span>
              <select
                className={selectClass}
                value={couponForm.type}
                onChange={(e) =>
                  setCouponForm((f) => ({ ...f, type: e.target.value as 'percentage' | 'fixed' }))
                }
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed (Rs)</option>
              </select>
            </label>
            <div className="w-28">
              <Field
                label={couponForm.type === 'percentage' ? 'Percent' : 'Rs off'}
                type="number"
                min={1}
                value={couponForm.value}
                onChange={(e) =>
                  setCouponForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div className="w-40">
              <Field
                label="From"
                type="date"
                value={couponForm.from}
                onChange={(e) => setCouponForm((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="w-40">
              <Field
                label="To"
                type="date"
                value={couponForm.to}
                onChange={(e) => setCouponForm((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <div className="w-24">
              <Field
                label="Max uses"
                type="number"
                min={0}
                value={couponForm.maxUses}
                onChange={(e) =>
                  setCouponForm((f) => ({ ...f, maxUses: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>

          <div className="mt-4 flex flex-col gap-2">
            {coupons.length === 0 && <p className="text-sm text-ink-3">No coupons yet.</p>}
            {coupons.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-line px-4 py-3"
              >
                <Pill tone="brand">{c.code}</Pill>
                <span className="font-semibold text-ink">
                  {c.type === 'percentage' ? `${Number(c.value)}% off` : `${money(c.value)} off`}
                </span>
                <span className="font-mono text-xs text-ink-3">
                  {c.startDate} → {c.endDate} · used {c.usedCount}
                  {c.maxUses > 0 ? `/${c.maxUses}` : ''}
                </span>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => delCoupon(c.id)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Referrals */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink">Referral partners</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <form onSubmit={addPartner} className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Field
                  label="Partner name"
                  value={partnerForm.name}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Lanka Tours"
                />
              </div>
              <div className="w-32">
                <Field
                  label="Code"
                  value={partnerForm.code}
                  onChange={(e) =>
                    setPartnerForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="LANKA"
                />
              </div>
              <div className="w-24">
                <Field
                  label="Comm. %"
                  type="number"
                  min={0}
                  max={90}
                  value={partnerForm.commissionPct}
                  onChange={(e) =>
                    setPartnerForm((f) => ({ ...f, commissionPct: Number(e.target.value) || 0 }))
                  }
                />
              </div>
              <Button type="submit" disabled={busy}>
                Add
              </Button>
            </form>
            <div className="mt-4 flex flex-col gap-2">
              {partners.length === 0 && (
                <p className="text-sm text-ink-3">No referral partners yet.</p>
              )}
              {partners.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-line px-4 py-3"
                >
                  <Pill tone="brand">{p.code}</Pill>
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="font-mono text-xs text-ink-3">
                    {Number(p.commissionPct)}% commission
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    className="!px-3 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => delPartner(p.id)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
              Earned commissions
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {commissions.length === 0 && (
                <p className="text-sm text-ink-3">No commissions recorded yet.</p>
              )}
              {commissions.map((c) => (
                <div key={c.id} className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-ink">{c.partnerName}</span>
                  <span className="font-mono text-xs text-ink-3">{c.bookingReference}</span>
                  <div className="flex-1" />
                  <span className="font-mono font-semibold">{money(c.amount)}</span>
                  <Pill tone={c.status === 'paid' ? 'avail' : 'low'}>{c.status}</Pill>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
