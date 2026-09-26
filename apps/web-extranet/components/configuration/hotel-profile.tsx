'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { POLICY_FIELDS, PROPERTY_AMENITIES } from '@yohobed/domain';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  Field,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@yohobed/ui';
import {
  createProperty,
  updatePropertyProfile,
  type Property,
  type PropertyPolicies,
  type PropertyProfilePatch,
} from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { PhotoManager } from '@/components/photo-manager';
import { CataloguePicker } from './catalogue-picker';
import { PropertyProfileForm } from './property-profile-form';
import { errorMessage } from './shared';

export const PROFILE_TABS = ['profile', 'highlights', 'amenities', 'photos', 'policies'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
const TAB_LABEL: Record<ProfileTab, string> = {
  profile: 'Profile',
  highlights: 'Highlights',
  amenities: 'Amenities',
  photos: 'Photo gallery',
  policies: 'Policies',
};

/**
 * Yanolja's Hotel Profile (Configuration → Hotel profile): who the hotel is, what makes it worth
 * the stay, what it offers, how it looks and the rules a guest agrees to — one tab each. The
 * tab is in the address, so a link can open any of them.
 */
export function HotelProfile({
  property,
  canEdit,
  tab,
}: {
  property: Property;
  canEdit: boolean;
  tab: ProfileTab;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.properties });
  return (
    <Tabs
      value={tab}
      onValueChange={(t) =>
        router.replace(`/app/configuration/profile${t === 'profile' ? '' : `?tab=${t}`}`, {
          scroll: false,
        })
      }
    >
      <TabsList className="mb-4">
        {PROFILE_TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {TAB_LABEL[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="profile">
        <PropertyProfileForm property={property} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="highlights">
        <HighlightsForm key={property.id} property={property} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="amenities">
        <AmenitiesForm key={property.id} property={property} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="photos">
        <Card className="p-5">
          <p className="mb-3 max-w-2xl text-sm text-ink-3">
            The first photo is the cover, used wherever one picture stands for the hotel. Move a
            photo earlier or later to change the order guests see.
          </p>
          <PhotoManager
            key={`${property.id}:${property.logoMediaId ?? ''}`}
            target="property"
            id={property.id}
            label={property.name}
            canEdit={canEdit}
            onChanged={refresh}
          />
        </Card>
      </TabsContent>
      <TabsContent value="policies">
        <PoliciesForm key={property.id} property={property} canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}

/** Save part of the profile, with the toast and the refresh every tab shares. */
function useProfileSave(property: Property, done: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PropertyProfilePatch) => updatePropertyProfile(property.id, body),
    onSuccess: () => {
      toast.success(done);
      qc.invalidateQueries({ queryKey: queryKeys.properties });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function SaveBar({
  dirty,
  saving,
  disabled,
  onReset,
  onSave,
  label,
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onReset: () => void;
  onSave: () => void;
  label: string;
}) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
      {dirty && <span className="mr-auto text-xs text-ink-3">Unsaved changes</span>}
      <Button variant="outline" disabled={!dirty || saving} onClick={onReset}>
        Reset
      </Button>
      <Button loading={saving} disabled={!dirty || disabled} onClick={onSave}>
        {label}
      </Button>
    </div>
  );
}

const MAX_HIGHLIGHTS = 10;

function HighlightsForm({ property, canEdit }: { property: Property; canEdit: boolean }) {
  const initial = React.useMemo(
    () => ({ description: property.description ?? '', highlights: property.highlights ?? [] }),
    [property.description, property.highlights],
  );
  const [description, setDescription] = React.useState(initial.description);
  const [items, setItems] = React.useState<string[]>(initial.highlights);
  React.useEffect(() => {
    setDescription(initial.description);
    setItems(initial.highlights);
  }, [initial]);
  const save = useProfileSave(property, 'Highlights saved');
  const cleaned = items.map((h) => h.trim()).filter(Boolean);
  const dirty =
    description.trim() !== initial.description.trim() ||
    cleaned.join('\u0000') !== initial.highlights.join('\u0000');
  const move = (i: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(i + by, 0, x!);
      return next;
    });

  return (
    <Card className="p-5">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5">
        <Field
          label="About the hotel"
          htmlFor="hotel-description"
          hint="A few sentences guests read first — on the booking engine and in emails."
        >
          <Textarea
            id="hotel-description"
            rows={6}
            maxLength={4000}
            value={description}
            placeholder="A 12-room boutique hotel on the Galle Fort ramparts, a short walk from the lighthouse…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div>
          <p className="text-sm font-medium text-ink">Highlights</p>
          <p className="mb-3 text-xs text-ink-3">
            Up to {MAX_HIGHLIGHTS} short lines — what makes the stay worth it.
          </p>
          <ol className="flex flex-col gap-2">
            {items.map((h, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 text-right font-mono text-xs text-ink-3">{i + 1}.</span>
                <Input
                  aria-label={`Highlight ${i + 1}`}
                  value={h}
                  maxLength={120}
                  placeholder="e.g. Sunset views over the Indian Ocean"
                  onChange={(e) =>
                    setItems((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move highlight ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={15} aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move highlight ${i + 1} down`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={15} aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove highlight ${i + 1}`}
                  onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash size={15} aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={items.length >= MAX_HIGHLIGHTS}
              onClick={() => setItems((list) => [...list, ''])}
            >
              <Plus size={14} aria-hidden /> Add a highlight
            </Button>
          )}
        </div>
      </fieldset>
      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          label="Save highlights"
          onReset={() => {
            setDescription(initial.description);
            setItems(initial.highlights);
          }}
          onSave={() =>
            save.mutate({ description: description.trim() || null, highlights: cleaned })
          }
        />
      )}
    </Card>
  );
}

function AmenitiesForm({ property, canEdit }: { property: Property; canEdit: boolean }) {
  const initial = React.useMemo(() => property.amenities ?? [], [property.amenities]);
  const [picked, setPicked] = React.useState<string[]>(initial);
  React.useEffect(() => setPicked(initial), [initial]);
  const save = useProfileSave(property, 'Amenities saved');
  const dirty = picked.join() !== initial.join();
  return (
    <Card className="p-5">
      <p className="mb-4 max-w-2xl text-sm text-ink-3">
        What the whole hotel offers. Room-by-room amenities are on each room type.{' '}
        <span className="font-medium text-ink">{picked.length} ticked.</span>
      </p>
      <CataloguePicker
        groups={PROPERTY_AMENITIES}
        value={picked}
        onChange={setPicked}
        disabled={!canEdit}
        idPrefix="hotel-amenity"
      />
      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          label="Save amenities"
          onReset={() => setPicked(initial)}
          onSave={() => save.mutate({ amenities: picked })}
        />
      )}
    </Card>
  );
}

function PoliciesForm({ property, canEdit }: { property: Property; canEdit: boolean }) {
  const initial = React.useMemo(() => property.policies ?? {}, [property.policies]);
  const [draft, setDraft] = React.useState<PropertyPolicies>(initial);
  React.useEffect(() => setDraft(initial), [initial]);
  const save = useProfileSave(property, 'Policies saved');
  const dirty = POLICY_FIELDS.some(
    (f) => (draft[f.key] ?? '').trim() !== (initial[f.key] ?? '').trim(),
  );
  return (
    <Card className="p-5">
      <p className="mb-4 max-w-2xl text-sm text-ink-3">
        The rules a guest agrees to, in your own words. They print on the confirmation voucher and
        show wherever the hotel is booked.
      </p>
      <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
        {POLICY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`policy-${f.key}`}>
            <Textarea
              id={`policy-${f.key}`}
              rows={3}
              maxLength={2000}
              placeholder={f.hint}
              value={draft[f.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
      </fieldset>
      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          label="Save policies"
          onReset={() => setDraft(initial)}
          onSave={() => {
            const policies: PropertyPolicies = {};
            for (const f of POLICY_FIELDS) {
              const v = (draft[f.key] ?? '').trim();
              if (v) policies[f.key] = v;
            }
            save.mutate({ policies });
          }}
        />
      )}
    </Card>
  );
}

/** Add another property to the account; it becomes the one being set up. */
export function AddPropertyButton({ onAdded }: { onAdded: (p: Property) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const add = useMutation({
    mutationFn: () => createProperty(name.trim()),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: queryKeys.properties });
      onAdded(p);
      toast.success(`${p.name} is added`, {
        description: 'You are now setting it up — start with its profile and room types.',
      });
      setOpen(false);
      setName('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> Add a property
      </Button>
      <DialogContent
        title="Add a property"
        description="Another hotel on this account. Fill in its profile, room types and rates next."
      >
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Field label="Property name" required htmlFor="new-property-name">
            <Input
              id="new-property-name"
              value={name}
              maxLength={200}
              placeholder="e.g. Cinnamon Grand"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
              Add property
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
