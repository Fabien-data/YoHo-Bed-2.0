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
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import { PhotoManager } from '@/components/photo-manager';

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
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
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
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
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
      <PageHeader
        eyebrow="Configuration"
        title="Property setup"
        description="Build the structure the calendar prices against: property → rooms → rate plans (meal plans) → occupancies (guest configurations)."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Properties */}
        <Section step={1} title="Properties">
          <div className="flex flex-col gap-1.5">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProperty(p.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                  propertyId === p.id
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line text-ink-2 hover:border-ink-3'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  {p.name}
                  {/* Base currency is a commercial term set by YoHoBed, so it is shown, not edited. */}
                  <span
                    className="font-mono text-[0.62rem] font-bold tracking-widest text-ink-3"
                    title={`${p.name} prices and settles in ${p.currency ?? 'LKR'}. Contact YoHoBed to change this.`}
                  >
                    {p.currency ?? 'LKR'}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <form onSubmit={addProperty} className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Field label="New property">
                <Input
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  placeholder="e.g. Cinnamon Grand"
                />
              </Field>
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
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line text-ink-2 hover:border-ink-3'
                    }`}
                  >
                    {r.name}
                    <span className="font-mono text-xs text-ink-3">×{r.quantity}</span>
                  </button>
                ))}
                {propertyRooms.length === 0 && <p className="text-sm text-ink-3">No rooms yet.</p>}
              </div>
              <form onSubmit={addRoom} className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <Field label="New room">
                    <Input
                      value={roomForm.name}
                      onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Garden Villa"
                    />
                  </Field>
                </div>
                <div className="w-20">
                  <Field label="Qty">
                    <Input
                      type="number"
                      min={0}
                      value={roomForm.quantity}
                      onChange={(e) =>
                        setRoomForm((f) => ({ ...f, quantity: Number(e.target.value) || 0 }))
                      }
                    />
                  </Field>
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
                      <Badge tone="brand">{p.code}</Badge>
                      <span className="text-sm font-semibold text-ink">{p.name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(occByPlan[p.id] ?? []).map((o) => (
                        <Badge key={o.id} tone="muted">
                          {o.label} · ×{o.accommodates}
                        </Badge>
                      ))}
                      {(occByPlan[p.id] ?? []).length === 0 && (
                        <span className="text-xs text-ink-3">No occupancies yet.</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <Input
                        className="w-28 flex-1"
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
                      <Input
                        className="w-16"
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
                        size="icon"
                        aria-label="Add occupancy"
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
                <Field label="Add meal plan" className="flex-1">
                  <Select value={newCode} onValueChange={setNewCode}>
                    <SelectTrigger aria-label="Meal plan">
                      <SelectValue placeholder="Select a meal plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {rateCodes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
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
