'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash } from '@phosphor-icons/react';
import { mealPlanOf, mealsOf, type MealPlan, type MealsIncluded } from '@yohobed/domain';
import { displayMealCode } from '@yohobed/locale';
import {
  Button,
  Card,
  Checkbox,
  Combobox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@yohobed/ui';
import {
  createRateType,
  listChargeParticulars,
  listRateTypes,
  updateRateType,
  type RateTypeInput,
} from '@/lib/api';
import { useHasFeature, usePropertySettings } from '@/lib/queries';
import { CHARGES_KEY } from './charges-tab';
import { rateTypesKey } from './rate-types';
import { SettingRow, errorMessage } from './shared';

interface AddOnDraft {
  key: string;
  chargeParticularId: string | null;
  name: string;
  amount: string;
  rhythm: 'once' | 'per_night';
}
interface Draft {
  name: string;
  shortCode: string;
  includesMeals: boolean;
  meals: MealsIncluded;
  includesAddOns: boolean;
  addOns: AddOnDraft[];
  description: string;
  active: boolean;
}

let seq = 0;
const newKey = () => `a${(seq += 1)}`;
const NO_MEALS: MealsIncluded = {
  breakfast: false,
  lunch: false,
  dinner: false,
  allInclusive: false,
};

/**
 * Yanolja's Edit Rate Type (Configuration → Rate types): a name and a code, whether the price
 * includes meals (and which), and whether it bundles chargeable add-ons — with Yanolja's own
 * explanation of both questions beside the form.
 */
export function RateTypeEditor({
  propertyId,
  rateTypeId,
  canEdit,
  currency,
}: {
  propertyId: string;
  rateTypeId: string | null;
  canEdit: boolean;
  currency: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: rateTypesKey(propertyId),
    queryFn: () => listRateTypes(propertyId),
  });
  const settings = usePropertySettings(propertyId);
  const hasFolio = useHasFeature('folio');
  const charges = useQuery({
    queryKey: CHARGES_KEY,
    queryFn: listChargeParticulars,
    enabled: hasFolio,
  });
  const current = rateTypeId ? types.data?.find((t) => t.id === rateTypeId) : undefined;
  const [draft, setDraft] = React.useState<Draft | null>(
    rateTypeId
      ? null
      : {
          name: '',
          shortCode: '',
          includesMeals: false,
          meals: NO_MEALS,
          includesAddOns: false,
          addOns: [],
          description: '',
          active: true,
        },
  );
  React.useEffect(() => {
    if (current && !draft)
      setDraft({
        name: current.name,
        shortCode: current.shortCode,
        includesMeals: current.mealPlan !== 'RO',
        meals: mealsOf(current.mealPlan),
        includesAddOns: current.addOns.length > 0,
        addOns: current.addOns.map((a) => ({
          ...a,
          key: newKey(),
          amount: String(Number(a.amount)),
        })),
        description: current.description ?? '',
        active: current.active,
      });
  }, [current, draft]);

  const save = useMutation({
    mutationFn: (body: RateTypeInput) =>
      rateTypeId ? updateRateType(rateTypeId, body) : createRateType(propertyId, body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: rateTypesKey(propertyId) });
      qc.invalidateQueries({ queryKey: ['config', 'rate-plans'] });
      qc.invalidateQueries({ queryKey: ['room-availability'] });
      toast.success(rateTypeId ? `${saved.name} is saved` : `${saved.name} is added`, {
        description: rateTypeId ? undefined : 'Sell it on a room type under Rate plans.',
      });
      router.push('/app/configuration/rate-types');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (rateTypeId && types.isSuccess && !current)
    return (
      <EmptyState
        title="That rate type is not here"
        description="It may have been deleted, or it belongs to another property."
        action={
          <Button variant="secondary" asChild>
            <Link href="/app/configuration/rate-types">Back to rate types</Link>
          </Button>
        }
      />
    );

  const back = (
    <Button variant="outline" asChild>
      <Link href="/app/configuration/rate-types">
        <ArrowLeft size={16} aria-hidden /> Rate types
      </Link>
    </Button>
  );
  if (!draft)
    return (
      <>
        <PageHeader eyebrow="Configuration · Rate types" title="Edit rate type" actions={back} />
        <Skeleton className="h-96 w-full" />
      </>
    );

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const plan: MealPlan = draft.includesMeals ? mealPlanOf(draft.meals) : 'RO';
  const style = settings.data?.mealCodeStyle ?? 'international';
  const offered = settings.data?.mealPlans.offered ?? [];
  const locked = Boolean(current?.booked) && current?.mealPlan !== plan;
  const mealsMissing = draft.includesMeals && plan === 'RO';
  const addOnsReady = !draft.includesAddOns || draft.addOns.every((a) => a.name.trim());
  const valid =
    Boolean(draft.name.trim() && draft.shortCode.trim()) && !mealsMissing && addOnsReady && !locked;

  const setMeal = (key: keyof MealsIncluded, on: boolean) => {
    if (key === 'allInclusive')
      set({
        meals: on ? { breakfast: true, lunch: true, dinner: true, allInclusive: true } : NO_MEALS,
      });
    else set({ meals: { ...draft.meals, [key]: on, allInclusive: false } });
  };
  const setAddOn = (key: string, patch: Partial<AddOnDraft>) =>
    set({ addOns: draft.addOns.map((a) => (a.key === key ? { ...a, ...patch } : a)) });

  const chargeOptions = (charges.data ?? [])
    .filter((c) => c.active)
    .map((c) => ({ value: c.id, label: c.name, hint: c.code }));

  return (
    <div>
      <PageHeader
        eyebrow="Configuration · Rate types"
        title={rateTypeId ? 'Edit rate type' : 'New rate type'}
        description="Create and configure a pricing structure with included benefits and add-ons."
        actions={back}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && valid)
              save.mutate({
                name: draft.name.trim(),
                shortCode: draft.shortCode.trim(),
                mealPlan: plan,
                addOns: draft.includesAddOns
                  ? draft.addOns.map((a) => ({
                      chargeParticularId: a.chargeParticularId,
                      name: a.name.trim(),
                      amount: Number(a.amount) || 0,
                      rhythm: a.rhythm,
                    }))
                  : [],
                description: draft.description.trim() || null,
                active: draft.active,
              });
          }}
        >
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <Card className="flex flex-col gap-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Rate type name" required htmlFor="rt-name" className="col-span-2">
                  <Input
                    id="rt-name"
                    value={draft.name}
                    maxLength={80}
                    placeholder="e.g. Bed and breakfast"
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </Field>
                <Field label="Short code" required htmlFor="rt-code" hint="e.g. BB">
                  <Input
                    id="rt-code"
                    value={draft.shortCode}
                    maxLength={10}
                    className="font-mono uppercase"
                    onChange={(e) =>
                      set({ shortCode: e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase() })
                    }
                  />
                </Field>
              </div>
            </Card>

            <Card className="px-5 py-2">
              <SettingRow title="Does this rate type include meals?">
                <Switch
                  aria-label="Does this rate type include meals?"
                  checked={draft.includesMeals}
                  disabled={Boolean(current?.booked)}
                  onCheckedChange={(includesMeals) =>
                    set({ includesMeals, meals: includesMeals ? draft.meals : NO_MEALS })
                  }
                />
              </SettingRow>
              {draft.includesMeals && (
                <div className="flex flex-col gap-3 pb-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {(
                      [
                        ['breakfast', 'Breakfast'],
                        ['lunch', 'Lunch'],
                        ['dinner', 'Dinner'],
                        ['allInclusive', 'All inclusive'],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
                      >
                        <Checkbox
                          checked={draft.meals[key]}
                          disabled={Boolean(current?.booked)}
                          onCheckedChange={(c) => setMeal(key, c === true)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-ink-3">
                    Meal plan:{' '}
                    <span className="font-mono font-semibold text-ink">
                      {displayMealCode(plan, style)}
                    </span>
                    {mealsMissing && ' — tick the meals the price includes.'}
                  </p>
                  {!mealsMissing && offered.length > 0 && !offered.includes(plan) && (
                    <InlineAlert tone="warn">
                      You have switched this meal plan off under Meal plans. Switch it on there to
                      sell it.
                    </InlineAlert>
                  )}
                </div>
              )}
              {current?.booked && (
                <p className="pb-3 text-xs text-ink-3">
                  This rate type has been booked, so its meals are part of those stays and cannot
                  change. Make a new rate type for a different meal plan.
                </p>
              )}
              <SettingRow title="Does this rate type include chargeable add-ons?">
                <Switch
                  aria-label="Does this rate type include chargeable add-ons?"
                  checked={draft.includesAddOns}
                  onCheckedChange={(includesAddOns) =>
                    set({
                      includesAddOns,
                      addOns:
                        includesAddOns && draft.addOns.length === 0
                          ? [
                              {
                                key: newKey(),
                                chargeParticularId: null,
                                name: '',
                                amount: '',
                                rhythm: 'once',
                              },
                            ]
                          : draft.addOns,
                    })
                  }
                />
              </SettingRow>
              {draft.includesAddOns && (
                <div className="flex flex-col gap-2 pb-3">
                  {draft.addOns.map((a) => (
                    <div
                      key={a.key}
                      className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_9rem_auto]"
                    >
                      <Field label="Extra charge" htmlFor={`ao-charge-${a.key}`}>
                        <Combobox
                          id={`ao-charge-${a.key}`}
                          aria-label="Extra charge"
                          value={a.chargeParticularId}
                          options={chargeOptions}
                          clearable
                          placeholder={hasFolio ? 'Pick one…' : 'Not on your plan'}
                          emptyText="No extra charges yet — add them under Extra charges."
                          onChange={(id) => {
                            const c = charges.data?.find((x) => x.id === id);
                            setAddOn(a.key, {
                              chargeParticularId: id,
                              ...(c && !a.name ? { name: c.name } : {}),
                              ...(c && !a.amount ? { amount: String(Number(c.defaultPrice)) } : {}),
                            });
                          }}
                        />
                      </Field>
                      <Field label="Add-on" required htmlFor={`ao-name-${a.key}`}>
                        <Input
                          id={`ao-name-${a.key}`}
                          value={a.name}
                          maxLength={80}
                          placeholder="Airport pick-up"
                          onChange={(e) => setAddOn(a.key, { name: e.target.value })}
                        />
                      </Field>
                      <Field label={`Value (${currency})`} htmlFor={`ao-amount-${a.key}`}>
                        <Input
                          id={`ao-amount-${a.key}`}
                          inputMode="decimal"
                          className="font-mono tabular-nums"
                          value={a.amount}
                          onChange={(e) =>
                            setAddOn(a.key, { amount: e.target.value.replace(/[^\d.]/g, '') })
                          }
                        />
                      </Field>
                      <Field label="How often" htmlFor={`ao-rhythm-${a.key}`}>
                        <Select
                          value={a.rhythm}
                          onValueChange={(v) =>
                            setAddOn(a.key, { rhythm: v as AddOnDraft['rhythm'] })
                          }
                        >
                          <SelectTrigger id={`ao-rhythm-${a.key}`} aria-label="How often">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="once">Once a stay</SelectItem>
                            <SelectItem value="per_night">Every night</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${a.name || 'this add-on'}`}
                        onClick={() => set({ addOns: draft.addOns.filter((x) => x.key !== a.key) })}
                      >
                        <Trash size={15} aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={draft.addOns.length >= 10}
                      onClick={() =>
                        set({
                          addOns: [
                            ...draft.addOns,
                            {
                              key: newKey(),
                              chargeParticularId: null,
                              name: '',
                              amount: '',
                              rhythm: 'once',
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} aria-hidden /> Add an add-on
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="flex flex-col gap-4 p-5">
              <Field
                label="Description"
                htmlFor="rt-description"
                hint="For the desk: when to sell it."
              >
                <Textarea
                  id="rt-description"
                  rows={3}
                  maxLength={1000}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
              <div className="rounded-lg border border-line px-3">
                <SettingRow
                  title="Sell this rate type"
                  description="Off: its rates are not offered for new reservations."
                >
                  <Switch
                    aria-label="Sell this rate type"
                    checked={draft.active}
                    onCheckedChange={(active) => set({ active })}
                  />
                </SettingRow>
              </div>
            </Card>
          </fieldset>
          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/app/configuration/rate-types')}
              >
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!valid}>
                {rateTypeId ? 'Update' : 'Add rate type'}
              </Button>
            </div>
          )}
        </form>

        <aside
          aria-label="Information"
          className="h-fit rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-2 xl:sticky xl:top-4"
        >
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink">
            Information
          </h2>
          <h3 className="mb-1 font-semibold text-ink">Does this rate type include meals?</h3>
          <p className="mb-2">
            Choose <strong>Yes</strong> if the room price already includes meals such as breakfast,
            lunch or dinner. For example, if your room rate is {currency} 15,000 and includes
            breakfast, choose Yes and tick Breakfast.
          </p>
          <p className="mb-4">
            <strong>Simple rule:</strong> if the guest gets the room and meals for one price, choose
            Yes. For the OTAs, mark meals separately in their extranet too.
          </p>
          <h3 className="mb-1 font-semibold text-ink">
            Does this rate type include chargeable add-ons?
          </h3>
          <p className="mb-2">
            Choose <strong>Yes</strong> if the rate is a package with paid extras. For example, a{' '}
            {currency} 30,000 package is the room at {currency} 24,000 plus an airport pick-up worth{' '}
            {currency} 6,000: the guest sees one price.
          </p>
          <p>
            Each booking on this rate lists the add-on as <strong>included</strong>, so the desk
            knows it is paid for and it is never charged again.
          </p>
        </aside>
      </div>
    </div>
  );
}
