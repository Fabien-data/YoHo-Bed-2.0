'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from '@phosphor-icons/react';
import { BED_TYPES, ROOM_AMENITIES } from '@yohobed/domain';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  NumberStepper,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TagColorPicker,
  Textarea,
  toast,
} from '@yohobed/ui';
import {
  createBulkRooms,
  createRoomType,
  createRoomUnit,
  listRoomTypes,
  listRoomUnits,
  updateRoomType,
  type Room,
  type RoomTypeInput,
} from '@/lib/api';
import { PhotoManager } from '@/components/photo-manager';
import { CataloguePicker } from './catalogue-picker';
import { roomTypesKey } from './room-types';
import { SettingRow, errorMessage } from './shared';

interface Basic {
  name: string;
  shortCode: string;
  quantity: number;
  baseAdults: number;
  baseChildren: number;
  maxAdults: number;
  maxChildren: number;
  description: string;
  bedTypes: string[];
  color: string | null;
  active: boolean;
}

function basicOf(r?: Room): Basic {
  return {
    name: r?.name ?? '',
    shortCode: r?.shortCode ?? '',
    quantity: r?.quantity ?? 1,
    baseAdults: r?.baseAdults ?? 2,
    baseChildren: r?.baseChildren ?? 0,
    maxAdults: r?.maxAdults ?? r?.baseAdults ?? 2,
    maxChildren: r?.maxChildren ?? r?.baseChildren ?? 0,
    description: r?.description ?? '',
    bedTypes: r?.bedTypes ?? [],
    color: r?.color ?? null,
    active: r?.active ?? true,
  };
}

const TABS = ['basic', 'amenities', 'images', 'rooms'] as const;
type Tab = (typeof TABS)[number];

/**
 * Yanolja's Room Type editor (Configuration → Room types): Basic information — the name, short
 * code, how many rooms, the guests the rate includes and the most the room takes, the beds and a
 * colour — then its Amenities, Images and numbered Rooms.
 */
export function RoomTypeEditor({
  propertyId,
  roomId,
  canEdit,
  initialTab,
}: {
  propertyId: string;
  /** Null for a new room type. */
  roomId: string | null;
  canEdit: boolean;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: roomTypesKey(propertyId),
    queryFn: () => listRoomTypes(propertyId),
  });
  const room = roomId ? types.data?.find((r) => r.id === roomId) : undefined;
  const [tab, setTab] = React.useState<Tab>(
    TABS.includes(initialTab as Tab) && roomId ? (initialTab as Tab) : 'basic',
  );
  const [basic, setBasic] = React.useState<Basic | null>(roomId ? null : basicOf());
  const [amenities, setAmenities] = React.useState<string[] | null>(roomId ? null : []);
  React.useEffect(() => {
    if (room) {
      setBasic((b) => b ?? basicOf(room));
      setAmenities((a) => a ?? room.amenities ?? []);
    }
  }, [room]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: roomTypesKey(propertyId) });
    qc.invalidateQueries({ queryKey: ['room-availability'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
  };
  const save = useMutation({
    mutationFn: async (body: RoomTypeInput) =>
      roomId
        ? updateRoomType(roomId, body)
        : createRoomType(propertyId, { ...body, name: body.name! }),
    onSuccess: (saved) => {
      refresh();
      if (!roomId) {
        toast.success(`${saved.name} is added`, {
          description: 'Now add its amenities, photos and numbered rooms.',
        });
        router.replace(`/app/configuration/room-types/${saved.id}?tab=amenities`);
      } else toast.success(`${saved.name} is saved`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (roomId && types.isSuccess && !room)
    return (
      <EmptyState
        title="That room type is not here"
        description="It may have been deleted, or it belongs to another property."
        action={
          <Button variant="secondary" asChild>
            <Link href="/app/configuration/room-types">Back to room types</Link>
          </Button>
        }
      />
    );

  const back = (
    <Button variant="outline" asChild>
      <Link href="/app/configuration/room-types">
        <ArrowLeft size={16} aria-hidden /> Room types
      </Link>
    </Button>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Configuration · Room types"
        title={roomId ? (room?.name ?? 'Room type') : 'New room type'}
        actions={back}
      />
      {!basic ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="mb-4 overflow-x-auto">
            <TabsTrigger value="basic">Basic information</TabsTrigger>
            <TabsTrigger value="amenities" disabled={!roomId}>
              Amenities
            </TabsTrigger>
            <TabsTrigger value="images" disabled={!roomId}>
              Images
            </TabsTrigger>
            <TabsTrigger value="rooms" disabled={!roomId}>
              Rooms
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <BasicForm
              value={basic}
              onChange={setBasic}
              canEdit={canEdit}
              saving={save.isPending}
              isNew={!roomId}
              onSave={() =>
                save.mutate({
                  name: basic.name.trim(),
                  shortCode: basic.shortCode.trim() || null,
                  quantity: basic.quantity,
                  baseAdults: basic.baseAdults,
                  baseChildren: basic.baseChildren,
                  maxAdults: basic.maxAdults,
                  maxChildren: basic.maxChildren,
                  description: basic.description.trim() || null,
                  bedTypes: basic.bedTypes,
                  color: basic.color as RoomTypeInput['color'],
                  active: basic.active,
                })
              }
              onCancel={() => router.push('/app/configuration/room-types')}
            />
          </TabsContent>

          {roomId && (
            <>
              <TabsContent value="amenities">
                <Card className="p-5">
                  <CataloguePicker
                    groups={ROOM_AMENITIES}
                    value={amenities ?? []}
                    onChange={setAmenities}
                    disabled={!canEdit}
                    idPrefix="room-amenity"
                  />
                </Card>
                {canEdit && (
                  <div className="mt-4 flex justify-end">
                    <Button
                      loading={save.isPending}
                      onClick={() => save.mutate({ amenities: amenities ?? [] })}
                    >
                      Save amenities
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="images">
                <Card className="p-5">
                  <PhotoManager
                    target="room"
                    id={roomId}
                    label={room?.name ?? 'Room type'}
                    canEdit={canEdit}
                    onChanged={refresh}
                  />
                </Card>
              </TabsContent>
              <TabsContent value="rooms">
                <RoomsOfType
                  propertyId={propertyId}
                  roomId={roomId}
                  roomName={room?.name ?? ''}
                  quantity={room?.quantity ?? 0}
                  canEdit={canEdit}
                />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  );
}

function BasicForm({
  value,
  onChange,
  canEdit,
  saving,
  isNew,
  onSave,
  onCancel,
}: {
  value: Basic;
  onChange: (b: Basic) => void;
  canEdit: boolean;
  saving: boolean;
  isNew: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Basic>) => onChange({ ...value, ...patch });
  const baseTooHigh = value.baseAdults > value.maxAdults || value.baseChildren > value.maxChildren;
  const valid = Boolean(value.name.trim()) && !baseTooHigh && value.maxAdults >= 1;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit && valid) onSave();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-8">
            <Field
              label="Room type"
              required
              htmlFor="rt-name"
              className="col-span-2 md:col-span-4"
            >
              <Input
                id="rt-name"
                value={value.name}
                maxLength={200}
                placeholder="e.g. Deluxe Double"
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Short code" htmlFor="rt-code" hint="e.g. DLX" className="md:col-span-1">
              <Input
                id="rt-code"
                value={value.shortCode}
                maxLength={10}
                className="font-mono uppercase"
                onChange={(e) => set({ shortCode: e.target.value.replace(/[^A-Za-z0-9-]/g, '') })}
              />
            </Field>
            <Field label="Number of rooms" required htmlFor="rt-quantity" className="md:col-span-1">
              <NumberStepper
                id="rt-quantity"
                aria-label="Number of rooms"
                value={value.quantity}
                min={0}
                max={999}
                onChange={(quantity) => set({ quantity })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ['baseAdults', 'Base adults', 'Adults the rate includes'],
                ['baseChildren', 'Base children', 'Children the rate includes'],
                ['maxAdults', 'Max adults', 'The most the room takes'],
                ['maxChildren', 'Max children', 'The most the room takes'],
              ] as const
            ).map(([key, label, hint]) => (
              <Field key={key} label={label} required hint={hint} htmlFor={`rt-${key}`}>
                <NumberStepper
                  id={`rt-${key}`}
                  aria-label={label}
                  value={value[key]}
                  min={key === 'maxAdults' ? 1 : 0}
                  max={20}
                  onChange={(n) => set({ [key]: n } as Partial<Basic>)}
                />
              </Field>
            ))}
          </div>
          {baseTooHigh && (
            <InlineAlert tone="error">
              The guests the rate includes cannot be more than the room takes.
            </InlineAlert>
          )}
          <p className="-mt-1 text-xs text-ink-3">
            A reservation with more adults or children than the maximum is refused.
          </p>

          <Field label="Description" htmlFor="rt-description">
            <Textarea
              id="rt-description"
              rows={3}
              maxLength={2000}
              value={value.description}
              placeholder="What the guest gets: size, view, bed, bathroom."
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>

          <div>
            <div className="mb-2 text-sm font-medium text-ink-2">
              Which beds are available in this room type?
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {BED_TYPES.map((b) => {
                const on = value.bedTypes.includes(b.code);
                return (
                  <label
                    key={b.code}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
                  >
                    <Checkbox
                      checked={on}
                      onCheckedChange={(c) =>
                        set({
                          bedTypes: BED_TYPES.map((t) => t.code).filter((code) =>
                            code === b.code ? c === true : value.bedTypes.includes(code),
                          ),
                        })
                      }
                    />
                    {b.label}
                  </label>
                );
              })}
            </div>
          </div>
        </Card>

        <Card className="px-5 py-2">
          <h2 className="pt-3 text-sm font-semibold text-ink">Advanced settings</h2>
          <SettingRow
            title="Sell this room type"
            description="Off: new reservations cannot choose it. Stays already booked are not touched."
          >
            <Switch
              aria-label="Sell this room type"
              checked={value.active}
              onCheckedChange={(active) => set({ active })}
            />
          </SettingRow>
          <SettingRow title="Colour" description="Marks the room type on Stay View and in lists.">
            <TagColorPicker
              value={value.color ?? 'slate'}
              onChange={(color) => set({ color })}
              disabled={!canEdit}
            />
          </SettingRow>
        </Card>
      </fieldset>

      {canEdit && (
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!valid}>
            {isNew ? 'Add room type' : 'Save'}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * Yanolja's Rooms tab: the numbered rooms of this type. Add one, or a run of them ("101" to
 * "110"); everything else about a room — floor plan, smoking, connected rooms — is in Room View.
 */
function RoomsOfType({
  propertyId,
  roomId,
  roomName,
  quantity,
  canEdit,
}: {
  propertyId: string;
  roomId: string;
  roomName: string;
  quantity: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const units = useQuery({
    queryKey: ['room-units', propertyId],
    queryFn: () => listRoomUnits(propertyId),
  });
  const mine = (units.data ?? []).filter((u) => u.roomId === roomId);
  const [single, setSingle] = React.useState({ code: '', displayName: '', floor: '' });
  const [range, setRange] = React.useState({ from: '', to: '', floor: '' });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room-units', propertyId] });
    qc.invalidateQueries({ queryKey: roomTypesKey(propertyId) });
    qc.invalidateQueries({ queryKey: ['stayview'] });
  };
  const addOne = useMutation({
    mutationFn: () =>
      createRoomUnit(propertyId, {
        roomId,
        code: single.code.trim(),
        displayName: single.displayName.trim() || null,
        ...(single.floor.trim() ? { floor: single.floor.trim() } : {}),
      }),
    onSuccess: (u) => {
      toast.success(`Room ${u.code} is added`);
      setSingle({ code: '', displayName: '', floor: single.floor });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // "101" to "110": a run of numbered rooms at once, padded like the first one.
  const runOf = () => {
    const from = Number(range.from);
    const to = Number(range.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from > 199) return [];
    const width = range.from.length;
    return Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(width, '0'));
  };
  const addRange = useMutation({
    mutationFn: () =>
      createBulkRooms(
        propertyId,
        runOf().map((code) => ({
          roomId,
          code,
          ...(range.floor.trim() ? { floor: range.floor.trim() } : {}),
        })),
      ),
    onSuccess: (made) => {
      toast.success(`${made.length} rooms are added`);
      setRange({ from: '', to: '', floor: range.floor });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      {mine.length > 0 && mine.length !== quantity && (
        <InlineAlert tone="info">
          {roomName} has {mine.length} numbered room{mine.length === 1 ? '' : 's'} but sells{' '}
          {quantity}. Set the number of rooms under Basic information to match.
        </InlineAlert>
      )}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)_6rem_6rem] gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          <span>Room</span>
          <span>Name</span>
          <span>Floor</span>
          <span className="text-right">Status</span>
        </div>
        {units.isLoading ? (
          <Skeleton className="m-3 h-10" />
        ) : mine.length === 0 ? (
          <EmptyState
            title="No numbered rooms yet"
            description="Add the rooms of this type so the desk can put guests in them."
          />
        ) : (
          <ul>
            {mine.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-[6rem_minmax(0,1fr)_6rem_6rem] items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0"
              >
                <span className="font-mono font-semibold text-ink">{u.code}</span>
                <span className="truncate text-ink-2">{u.displayName ?? ''}</span>
                <span className="text-ink-2">{u.floor ?? '—'}</span>
                <span className="text-right">
                  {u.status === 'active' ? (
                    <Badge tone="avail">In service</Badge>
                  ) : (
                    <Badge tone="muted">Out of service</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Add a room</h3>
            <form
              className="grid grid-cols-3 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (single.code.trim()) addOne.mutate();
              }}
            >
              <Field label="Room" required htmlFor="ru-code">
                <Input
                  id="ru-code"
                  value={single.code}
                  maxLength={16}
                  placeholder="101"
                  className="font-mono"
                  onChange={(e) => setSingle({ ...single, code: e.target.value })}
                />
              </Field>
              <Field label="Name" htmlFor="ru-name" hint="optional">
                <Input
                  id="ru-name"
                  value={single.displayName}
                  maxLength={60}
                  placeholder="Lotus"
                  onChange={(e) => setSingle({ ...single, displayName: e.target.value })}
                />
              </Field>
              <Field label="Floor" htmlFor="ru-floor">
                <Input
                  id="ru-floor"
                  value={single.floor}
                  maxLength={10}
                  onChange={(e) => setSingle({ ...single, floor: e.target.value })}
                />
              </Field>
              <div className="col-span-3 flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={addOne.isPending}
                  disabled={!single.code.trim()}
                >
                  <Plus size={14} aria-hidden /> Add room
                </Button>
              </div>
            </form>
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Add a run of rooms</h3>
            <form
              className="grid grid-cols-3 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (runOf().length) addRange.mutate();
              }}
            >
              <Field label="From" required htmlFor="ru-from">
                <Input
                  id="ru-from"
                  inputMode="numeric"
                  value={range.from}
                  placeholder="101"
                  className="font-mono"
                  onChange={(e) => setRange({ ...range, from: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="To" required htmlFor="ru-to">
                <Input
                  id="ru-to"
                  inputMode="numeric"
                  value={range.to}
                  placeholder="110"
                  className="font-mono"
                  onChange={(e) => setRange({ ...range, to: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Floor" htmlFor="ru-range-floor">
                <Input
                  id="ru-range-floor"
                  value={range.floor}
                  maxLength={10}
                  onChange={(e) => setRange({ ...range, floor: e.target.value })}
                />
              </Field>
              <div className="col-span-3 flex items-center justify-between gap-2">
                <span className="text-xs text-ink-3">
                  {runOf().length ? `${runOf().length} rooms` : 'Up to 200 at a time'}
                </span>
                <Button
                  type="submit"
                  variant="secondary"
                  loading={addRange.isPending}
                  disabled={runOf().length === 0}
                >
                  <Plus size={14} aria-hidden /> Add rooms
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      <Link href="/app/roomview" className="text-sm font-medium text-brand-ink hover:underline">
        Floors, smoking, connected rooms and the floor plan are set in Room View →
      </Link>
    </div>
  );
}
