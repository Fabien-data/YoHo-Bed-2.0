'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MEAL_PLANS, mealsOf, type MealPlan } from '@yohobed/domain';
import { displayMealCode } from '@yohobed/locale';
import { Button, Card, Input, SegmentedControl, Skeleton, Switch, toast } from '@yohobed/ui';
import { updatePropertySettings, type PropertySettings } from '@/lib/api';
import { queryKeys, usePropertySettings } from '@/lib/queries';
import { SettingRow, errorMessage } from './shared';

const DEFAULT_NAME: Record<MealPlan, string> = {
  RO: 'Room only',
  BB: 'Bed and breakfast',
  HB: 'Half board',
  FB: 'Full board',
  AI: 'All inclusive',
};

/** What a plan includes, in words. */
function includes(plan: MealPlan): string {
  const m = mealsOf(plan);
  if (m.allInclusive) return 'Every meal, snacks and drinks';
  const meals = [m.breakfast && 'breakfast', m.lunch && 'lunch', m.dinner && 'dinner'].filter(
    Boolean,
  ) as string[];
  if (!meals.length) return 'No meals';
  const text = meals.join(meals.length === 3 ? ', ' : ' and ').replace(/, (\w+)$/, ' and $1');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Draft {
  mealCodeStyle: PropertySettings['mealCodeStyle'];
  offered: MealPlan[];
  names: Partial<Record<MealPlan, string>>;
}

/**
 * Yanolja's Meal Plan (Configuration → Meal plans): the five plans every rate is built on, which
 * of them this hotel sells, its own name for each, and the codes it reads them by. What each plan
 * includes is fixed, because the channels read it.
 */
export function MealPlansEditor({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const settings = usePropertySettings(propertyId);
  const initial = React.useMemo<Draft | null>(
    () =>
      settings.data
        ? {
            mealCodeStyle: settings.data.mealCodeStyle,
            offered: settings.data.mealPlans.offered,
            names: settings.data.mealPlans.names,
          }
        : null,
    [settings.data],
  );
  const [draft, setDraft] = React.useState<Draft | null>(null);
  React.useEffect(() => setDraft(initial), [initial]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      updatePropertySettings(propertyId, {
        mealCodeStyle: d.mealCodeStyle,
        mealPlans: {
          offered: d.offered,
          names: Object.fromEntries(MEAL_PLANS.map((p) => [p, d.names[p]?.trim() ?? ''])),
        },
      }),
    onSuccess: (saved) => {
      toast.success('Meal plans saved');
      qc.setQueryData(queryKeys.propertySettings(propertyId), saved);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!draft) return <Skeleton className="h-80 w-full" />;

  const toggle = (plan: MealPlan, on: boolean) => {
    const offered = on
      ? MEAL_PLANS.filter((p) => p === plan || draft.offered.includes(p))
      : draft.offered.filter((p) => p !== plan);
    if (offered.length === 0) {
      toast.error('A hotel sells at least one meal plan.');
      return;
    }
    setDraft({ ...draft, offered });
  };

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card className="px-5 py-2">
          <SettingRow
            title="Meal-plan codes"
            description="Indian hotels and OTAs read EP / CP / MAP / AP for the same plans."
          >
            <SegmentedControl
              aria-label="Meal-plan codes"
              value={draft.mealCodeStyle}
              onChange={(mealCodeStyle) => setDraft({ ...draft, mealCodeStyle })}
              options={[
                { value: 'international', label: 'RO · BB · HB · FB' },
                { value: 'indian', label: 'EP · CP · MAP · AP' },
              ]}
            />
          </SettingRow>
        </Card>

        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.2fr)_6rem] gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2 md:grid">
            <span>Code</span>
            <span>Includes</span>
            <span>Your name for it</span>
            <span className="text-right">Sold</span>
          </div>
          <ul className="divide-y divide-line">
            {MEAL_PLANS.map((plan) => {
              const on = draft.offered.includes(plan);
              return (
                <li
                  key={plan}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.2fr)_6rem]"
                >
                  <span className="font-mono text-sm font-semibold text-ink">
                    {displayMealCode(plan, draft.mealCodeStyle)}
                  </span>
                  <span className="text-sm text-ink-2">{includes(plan)}</span>
                  <Input
                    aria-label={`Name for ${plan}`}
                    className="col-span-3 md:col-span-1"
                    placeholder={DEFAULT_NAME[plan]}
                    maxLength={40}
                    value={draft.names[plan] ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, names: { ...draft.names, [plan]: e.target.value } })
                    }
                  />
                  <div className="col-start-3 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
                    <Switch
                      aria-label={`Sell ${DEFAULT_NAME[plan]}`}
                      checked={on}
                      onCheckedChange={(v) => toggle(plan, v)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="text-xs text-ink-3">
          A plan you stop selling is no longer offered for new rate types. Rates already built on it
          keep working until you switch them off.
        </p>
      </fieldset>
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty} onClick={() => setDraft(initial)}>
            Discard changes
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
