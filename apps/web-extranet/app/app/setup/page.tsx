'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listProperties,
  createProperty,
  listRooms,
  createRoom,
  listRateCodes,
  listRatePlans,
  createRatePlan,
  listOccupancies,
  createOccupancy,
  ApiError,
  type Property,
  type Room,
  type RateCode,
  type RatePlan,
  type Occupancy,
} from '@/lib/api';
import { Button, Card, Field, Pill } from '@/components/ui';
import { PhotoManager } from '@/components/photo-manager';

const selectClass =
  'rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

function Section({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: 'var(--brand)' }}
        >
          {step}
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export default function SetupPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState('');
  const [rateCodes, setRateCodes] = useState<RateCode[]>([]);
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [occByPlan, setOccByPlan] = useState<Record<string, Occupancy[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  const [propName, setPropName] = useState('');
  const [roomForm, setRoomForm] = useState({ name: '', quantity: 5 });
  const [newCode, setNewCode] = useState('');
  const [occForm, setOccForm] = useState<Record<string, { label: string; accommodates: number }>>(
    {},
  );

  const loadPlans = useCallback(async (rid: string) => {
    const ps = await listRatePlans(rid).catch(() => []);
    setPlans(ps);
    const map: Record<string, Occupancy[]> = {};
    for (const p of ps) map[p.id] = await listOccupancies(p.id).catch(() => []);
    setOccByPlan(map);
  }, []);

  useEffect(() => {
    (async () => {
      const [props, allRooms, codes] = await Promise.all([
        listProperties(),
        listRooms(),
        listRateCodes().catch(() => []),
      ]);
      setProperties(props);
      setRooms(allRooms);
      setRateCodes(codes);
      setNewCode(codes[0]?.id ?? '');
      const pid = props[0]?.id ?? '';
      setPropertyId(pid);
      const firstRoom = allRooms.find((r) => r.propertyId === pid);
      setRoomId(firstRoom?.id ?? '');
      if (firstRoom) await loadPlans(firstRoom.id);
    })().catch(() => {});
  }, [loadPlans]);

  const propertyRooms = useMemo(
    () => rooms.filter((r) => r.propertyId === propertyId),
    [rooms, propertyId],
  );

  async function selectProperty(pid: string) {
    setPropertyId(pid);
    const fr = rooms.filter((r) => r.propertyId === pid)[0];
    setRoomId(fr?.id ?? '');
    if (fr) await loadPlans(fr.id);
    else {
      setPlans([]);
      setOccByPlan({});
    }
  }
  async function selectRoom(id: string) {
    setRoomId(id);
    await loadPlans(id);
  }

  async function guard(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'avail', text: ok });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  const addProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propName.trim()) return;
    return guard(async () => {
      const p = await createProperty(propName.trim());
      setProperties((prev) => [...prev, p]);
      setPropName('');
      await selectProperty(p.id);
    }, 'Property created.');
  };

  const addRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId || !roomForm.name.trim()) return;
    return guard(async () => {
      const r = await createRoom(propertyId, roomForm.name.trim(), roomForm.quantity);
      setRooms((prev) => [...prev, r]);
      setRoomForm({ name: '', quantity: 5 });
      await selectRoom(r.id);
    }, 'Room added.');
  };

  const addPlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !newCode) return;
    return guard(async () => {
      await createRatePlan(roomId, newCode);
      await loadPlans(roomId);
    }, 'Rate plan added.');
  };

  const addOcc = (planId: string) => {
    const f = occForm[planId];
    if (!f || !f.label.trim()) return;
    return guard(async () => {
      await createOccupancy(planId, f.label.trim(), f.accommodates);
      setOccForm((prev) => ({ ...prev, [planId]: { label: '', accommodates: 2 } }));
      await loadPlans(roomId);
    }, 'Occupancy added.');
  };

  return (
    <div>
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">Onboarding</div>
      <h1 className="text-2xl font-bold tracking-tight text-ink">Property setup</h1>
      <p className="mt-1 text-sm text-ink-2">
        Build the structure the calendar prices against: property → rooms → rate plans (meal plans)
        → occupancies (guest configurations).
      </p>

      {msg && (
        <div
          className="mt-4 rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {/* Properties */}
        <Section step={1} title="Properties">
          <div className="flex flex-col gap-1.5">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProperty(p.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                  propertyId === p.id
                    ? 'border-brand text-brand-ink'
                    : 'border-line text-ink-2 hover:border-ink-3'
                }`}
                style={propertyId === p.id ? { background: 'var(--brand-soft)' } : undefined}
              >
                {p.name}
              </button>
            ))}
          </div>
          <form onSubmit={addProperty} className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Field
                label="New property"
                value={propName}
                onChange={(e) => setPropName(e.target.value)}
                placeholder="e.g. Cinnamon Grand"
              />
            </div>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
          {propertyId && (
            <PhotoManager
              target="property"
              id={propertyId}
              label={properties.find((p) => p.id === propertyId)?.name ?? 'property'}
            />
          )}
        </Section>

        {/* Rooms */}
        <Section step={2} title="Rooms">
          {!propertyId ? (
            <p className="text-sm text-ink-3">Select a property first.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {propertyRooms.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectRoom(r.id)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                      roomId === r.id
                        ? 'border-brand text-brand-ink'
                        : 'border-line text-ink-2 hover:border-ink-3'
                    }`}
                    style={roomId === r.id ? { background: 'var(--brand-soft)' } : undefined}
                  >
                    {r.name}
                    <span className="font-mono text-xs text-ink-3">×{r.quantity}</span>
                  </button>
                ))}
                {propertyRooms.length === 0 && <p className="text-sm text-ink-3">No rooms yet.</p>}
              </div>
              <form onSubmit={addRoom} className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label="New room"
                    value={roomForm.name}
                    onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Garden Villa"
                  />
                </div>
                <div className="w-20">
                  <Field
                    label="Qty"
                    type="number"
                    min={0}
                    value={roomForm.quantity}
                    onChange={(e) =>
                      setRoomForm((f) => ({ ...f, quantity: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  Add
                </Button>
              </form>
              {roomId && (
                <PhotoManager
                  target="room"
                  id={roomId}
                  label={propertyRooms.find((r) => r.id === roomId)?.name ?? 'room'}
                />
              )}
            </>
          )}
        </Section>

        {/* Rate plans + occupancies */}
        <Section step={3} title="Rate plans & occupancies">
          {!roomId ? (
            <p className="text-sm text-ink-3">Select a room first.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {plans.map((p) => (
                  <div key={p.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center gap-2">
                      <Pill tone="brand">{p.code}</Pill>
                      <span className="text-sm font-semibold text-ink">{p.name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(occByPlan[p.id] ?? []).map((o) => (
                        <Pill key={o.id} tone="muted">
                          {o.label} · ×{o.accommodates}
                        </Pill>
                      ))}
                      {(occByPlan[p.id] ?? []).length === 0 && (
                        <span className="text-xs text-ink-3">No occupancies yet.</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <input
                        className={`${selectClass} w-28 flex-1`}
                        placeholder="Occupancy"
                        value={occForm[p.id]?.label ?? ''}
                        onChange={(e) =>
                          setOccForm((prev) => ({
                            ...prev,
                            [p.id]: {
                              label: e.target.value,
                              accommodates: prev[p.id]?.accommodates ?? 2,
                            },
                          }))
                        }
                      />
                      <input
                        className={`${selectClass} w-16`}
                        type="number"
                        min={1}
                        value={occForm[p.id]?.accommodates ?? 2}
                        onChange={(e) =>
                          setOccForm((prev) => ({
                            ...prev,
                            [p.id]: {
                              label: prev[p.id]?.label ?? '',
                              accommodates: Number(e.target.value) || 1,
                            },
                          }))
                        }
                      />
                      <Button
                        variant="secondary"
                        className="!px-3"
                        disabled={busy}
                        onClick={() => addOcc(p.id)}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))}
                {plans.length === 0 && <p className="text-sm text-ink-3">No rate plans yet.</p>}
              </div>
              <form onSubmit={addPlan} className="mt-3 flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Add meal plan</span>
                  <select
                    className={selectClass}
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                  >
                    {rateCodes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={busy}>
                  Add plan
                </Button>
              </form>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
