'use client';

import * as React from 'react';
import Link from 'next/link';
import type { SmartPropertyDocument, SmartRoomPolicy, Supplement } from '@yohobed/domain';
import { Button, Card, Input, PageHeader } from '@yohobed/ui';
import { useActiveProperty } from '@/components/active-property';
import {
  createBulkRooms,
  getSmartSetup,
  previewBulkRooms,
  previewSmartBooking,
  saveSmartDraft,
  publishSmartSetup,
  type BulkRoomInput,
  type SmartSetupConfiguration,
} from '@/lib/api';

const steps = [
  'Property defaults',
  'Room categories',
  'Physical rooms',
  'Occupancy',
  'Meal plans and limits',
  'Review and publish',
] as const;
const initialPolicy = (): SmartRoomPolicy => ({
  capacity: {
    maxAdults: 3,
    maxChildren: 2,
    normalGuests: 2,
    absoluteGuests: 4,
    maxExtraBeds: 1,
    maxCots: 1,
  },
  includedAdults: 2,
  includedChildren: 0,
  childUsesAdultPlace: false,
  extraAdultMinor: 0,
  extraBedMinor: 0,
  cotMinor: 0,
  childBands: [
    {
      id: 'children',
      label: 'Children 0–17',
      minAge: 0,
      maxAge: 17,
      accommodation: { mode: 'fixed', amountMinor: 0 },
    },
  ],
});
const initialDocument = (): SmartPropertyDocument => ({
  schemaVersion: 1,
  readiness: 'clean',
  defaults: initialPolicy(),
  roomOverrides: {},
  rates: {},
});
const toMinor = (value: string) => Math.round(Number(value) * 100);
const moneyInput = (minor: number) => (minor / 100).toFixed(2);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Try again.';

function NumberField({
  label,
  value,
  onChange,
  money = false,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  money?: boolean;
  min?: number;
}) {
  return (
    <label className="text-xs font-semibold text-ink-2">
      {label}
      <Input
        className="mt-1 w-full"
        type="number"
        min={min}
        step={money ? '0.01' : '1'}
        value={money ? moneyInput(value) : value}
        onChange={(event) =>
          onChange(money ? toMinor(event.target.value) : Number(event.target.value))
        }
      />
    </label>
  );
}

function SupplementFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Supplement;
  onChange: (value: Supplement) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem] sm:items-end">
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      <select
        aria-label={`${label} charge type`}
        value={value.mode}
        onChange={(event) =>
          onChange(
            event.target.value === 'fixed'
              ? { mode: 'fixed', amountMinor: 0 }
              : { mode: 'percent', basisPoints: 0 },
          )
        }
        className="rounded-lg border border-line bg-surface px-2 py-2 text-sm"
      >
        <option value="fixed">Fixed</option>
        <option value="percent">% of adult</option>
      </select>
      <Input
        aria-label={`${label} charge`}
        type="number"
        min={0}
        step={value.mode === 'fixed' ? '0.01' : '0.01'}
        value={
          value.mode === 'fixed'
            ? moneyInput(value.amountMinor)
            : (value.basisPoints / 100).toFixed(2)
        }
        onChange={(event) =>
          onChange(
            value.mode === 'fixed'
              ? { mode: 'fixed', amountMinor: toMinor(event.target.value) }
              : { mode: 'percent', basisPoints: toMinor(event.target.value) },
          )
        }
      />
    </div>
  );
}

function PolicyEditor({
  policy,
  update,
  currency,
}: {
  policy: SmartRoomPolicy;
  update: (value: SmartRoomPolicy) => void;
  currency: string;
}) {
  const setCapacity = (key: keyof SmartRoomPolicy['capacity'], value: number) =>
    update({ ...policy, capacity: { ...policy.capacity, [key]: value } });
  const setAmount = (key: 'extraAdultMinor' | 'extraBedMinor' | 'cotMinor', value: number) =>
    update({ ...policy, [key]: value });
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">Physical capacity</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Maximum adults"
            value={policy.capacity.maxAdults}
            onChange={(v) => setCapacity('maxAdults', v)}
          />
          <NumberField
            label="Maximum children"
            value={policy.capacity.maxChildren}
            onChange={(v) => setCapacity('maxChildren', v)}
          />
          <NumberField
            label="Normal guests"
            value={policy.capacity.normalGuests}
            onChange={(v) => setCapacity('normalGuests', v)}
            min={1}
          />
          <NumberField
            label="Absolute guest limit, including infants"
            value={policy.capacity.absoluteGuests}
            onChange={(v) => setCapacity('absoluteGuests', v)}
            min={1}
          />
          <NumberField
            label="Extra beds allowed"
            value={policy.capacity.maxExtraBeds}
            onChange={(v) => setCapacity('maxExtraBeds', v)}
          />
          <NumberField
            label="Cots allowed"
            value={policy.capacity.maxCots}
            onChange={(v) => setCapacity('maxCots', v)}
          />
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">Included in the base price</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Included adults"
            value={policy.includedAdults}
            onChange={(v) => update({ ...policy, includedAdults: v })}
          />
          <NumberField
            label="Included children"
            value={policy.includedChildren}
            onChange={(v) => update({ ...policy, includedChildren: v })}
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={policy.childUsesAdultPlace}
            onChange={(event) => update({ ...policy, childUsesAdultPlace: event.target.checked })}
          />
          A child can use an unused included adult place for accommodation
        </label>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">Extra charges ({currency} per night)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Additional adult"
            money
            value={policy.extraAdultMinor}
            onChange={(v) => setAmount('extraAdultMinor', v)}
          />
          <NumberField
            label="Extra bed"
            money
            value={policy.extraBedMinor}
            onChange={(v) => setAmount('extraBedMinor', v)}
          />
          <NumberField
            label="Cot"
            money
            value={policy.cotMinor}
            onChange={(v) => setAmount('cotMinor', v)}
          />
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-bold text-ink">Child age bands</h3>
        <p className="mb-3 text-xs text-ink-3">
          Cover ages 0 through 17 with no gaps. A child’s age is required in each quote.
        </p>
        <div className="space-y-3">
          {policy.childBands.map((band, index) => (
            <div key={band.id} className="rounded-lg border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
                <label className="text-xs">
                  Band name
                  <Input
                    aria-label={`Band ${index + 1} name`}
                    value={band.label}
                    onChange={(event) =>
                      update({
                        ...policy,
                        childBands: policy.childBands.map((item, i) =>
                          i === index ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <NumberField
                  label="Age from"
                  value={band.minAge}
                  onChange={(v) =>
                    update({
                      ...policy,
                      childBands: policy.childBands.map((item, i) =>
                        i === index ? { ...item, minAge: v } : item,
                      ),
                    })
                  }
                />
                <NumberField
                  label="Age through"
                  value={band.maxAge}
                  onChange={(v) =>
                    update({
                      ...policy,
                      childBands: policy.childBands.map((item, i) =>
                        i === index ? { ...item, maxAge: v } : item,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      ...policy,
                      childBands: policy.childBands.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
              <div className="mt-2">
                <SupplementFields
                  label={`Accommodation (${currency} or %)`}
                  value={band.accommodation}
                  onChange={(value) =>
                    update({
                      ...policy,
                      childBands: policy.childBands.map((item, i) =>
                        i === index ? { ...item, accommodation: value } : item,
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() =>
            update({
              ...policy,
              childBands: [
                ...policy.childBands,
                {
                  id: `band_${Date.now()}`,
                  label: 'New age band',
                  minAge: 0,
                  maxAge: 0,
                  accommodation: { mode: 'fixed', amountMinor: 0 },
                },
              ],
            })
          }
        >
          Add age band
        </Button>
      </div>
    </div>
  );
}

export default function SmartSetupPage() {
  const { propertyId } = useActiveProperty();
  const [configuration, setConfiguration] = React.useState<SmartSetupConfiguration | null>(null);
  const [document, setDocument] = React.useState<SmartPropertyDocument>(initialDocument);
  const [version, setVersion] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [categoryId, setCategoryId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [acknowledgeChannelLimit, setAcknowledgeChannelLimit] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [issues, setIssues] = React.useState<SmartSetupConfiguration['issues']>([]);
  const [bulkText, setBulkText] = React.useState('');
  const [bulkCategoryId, setBulkCategoryId] = React.useState('');
  const [bulkFloor, setBulkFloor] = React.useState('');
  const [bulkReview, setBulkReview] = React.useState<Awaited<
    ReturnType<typeof previewBulkRooms>
  > | null>(null);
  const [book, setBook] = React.useState({
    occupancyId: '',
    checkin: '',
    checkout: '',
    adults: 2,
    ages: '',
    extraBeds: 0,
    cots: 0,
  });
  const [quote, setQuote] = React.useState<Awaited<ReturnType<typeof previewSmartBooking>> | null>(
    null,
  );
  React.useEffect(() => {
    if (!propertyId) return;
    let active = true;
    setConfiguration(null);
    setMessage('');
    getSmartSetup(propertyId)
      .then((value) => {
        if (!active) return;
        setConfiguration(value);
        setDocument(value.policy?.draft ?? initialDocument());
        setVersion(value.policy?.draftVersion ?? 0);
        setDirty(false);
        setIssues(value.issues);
        setCategoryId(value.categories[0]?.id ?? '');
        setBulkCategoryId(value.categories[0]?.id ?? '');
        setBook((previous) => ({ ...previous, occupancyId: value.rates[0]?.id ?? '' }));
      })
      .catch((error) => active && setMessage(errorText(error)));
    return () => {
      active = false;
    };
  }, [propertyId]);
  const modify = (value: SmartPropertyDocument) => {
    setDocument(value);
    setDirty(true);
    setQuote(null);
    setMessage('Unsaved changes');
  };
  const save = async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      const result = await saveSmartDraft(propertyId, version, document);
      setVersion(result.policy!.draftVersion);
      setDirty(false);
      setIssues(result.issues);
      setMessage(
        result.issues.length
          ? `Draft saved with ${result.issues.length} item(s) to review.`
          : 'Draft saved.',
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!propertyId || !configuration || !acknowledgeChannelLimit) return;
    setBusy(true);
    try {
      const result = await publishSmartSetup(propertyId, version);
      setConfiguration({ ...configuration, policy: result.policy });
      setMessage(`PMS policy version ${version} published. ${result.channelPublishing.reason}`);
      setAcknowledgeChannelLimit(false);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const currency = configuration?.property.currency ?? '';
  const category = configuration?.categories.find((item) => item.id === categoryId);
  const categoryPolicy = document.roomOverrides[categoryId] ?? document.defaults;
  const bulkUnits: BulkRoomInput[] = bulkText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, ...name] = line.split(',');
      return {
        roomId: bulkCategoryId,
        code: code!.trim(),
        displayName: name.join(',').trim() || null,
        floor: bulkFloor.trim() || undefined,
      };
    });
  const reviewBulk = async () => {
    if (!propertyId || !bulkUnits.length) return;
    setBusy(true);
    try {
      setBulkReview(await previewBulkRooms(propertyId, bulkUnits));
      setMessage('Review the codes and names before saving.');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const saveBulk = async () => {
    if (!propertyId || !bulkReview?.valid) return;
    setBusy(true);
    try {
      const created = await createBulkRooms(propertyId, bulkUnits);
      setMessage(`${created.length} physical rooms created.`);
      setBulkText('');
      setBulkReview(null);
    } catch (error) {
      setMessage(errorText(error));
      setBulkReview(null);
    } finally {
      setBusy(false);
    }
  };
  const tryBooking = async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      setQuote(
        await previewSmartBooking(propertyId, version, {
          occupancyId: book.occupancyId,
          checkin: book.checkin,
          checkout: book.checkout,
          guests: {
            adults: book.adults,
            childAges: book.ages
              .split(',')
              .map((age) => age.trim())
              .filter(Boolean)
              .map(Number),
            extraBeds: book.extraBeds,
            cots: book.cots,
          },
        }),
      );
      setMessage('Preview calculated from saved draft.');
    } catch (error) {
      setQuote(null);
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Configuration"
        title="Smart property setup"
        description="Define guest eligibility and prices before publishing them to the front desk."
        actions={
          <Link
            href="/app/configuration/room-types"
            className="text-sm font-semibold text-brand underline"
          >
            Room types
          </Link>
        }
      />
      {!configuration ? (
        <Card className="p-5 text-sm text-ink-2">{message || 'Loading property setup…'}</Card>
      ) : (
        <>
          <nav aria-label="Setup steps" className="flex flex-wrap gap-2">
            {steps.map((name, index) => (
              <button
                key={name}
                type="button"
                onClick={() => setStep(index)}
                aria-current={step === index ? 'step' : undefined}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${step === index ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-2'}`}
              >
                {index + 1}. {name}
              </button>
            ))}
          </nav>
          <Card className="p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-bold text-ink">{steps[step]}</h2>
            {step === 0 && (
              <>
                <PolicyEditor
                  policy={document.defaults}
                  update={(defaults) => modify({ ...document, defaults })}
                  currency={currency}
                />
                <div className="mt-5">
                  <label className="text-sm font-semibold text-ink">
                    Check-in readiness{' '}
                    <select
                      value={document.readiness}
                      onChange={(event) =>
                        modify({
                          ...document,
                          readiness: event.target.value as 'clean' | 'inspected',
                        })
                      }
                      className="ml-2 rounded-lg border border-line bg-surface px-2 py-2"
                    >
                      <option value="clean">Clean is ready</option>
                      <option value="inspected">Inspection required</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <p className="mb-3 text-sm text-ink-2">
                  Categories inherit defaults until customized. Physical rooms share their category
                  capacity and rates.
                </p>
                <select
                  aria-label="Room category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                >
                  {configuration.categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {category && (
                  <>
                    <label className="mb-4 flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!document.roomOverrides[categoryId]}
                        onChange={(event) => {
                          const next = { ...document.roomOverrides };
                          if (event.target.checked)
                            next[categoryId] = structuredClone(document.defaults);
                          else delete next[categoryId];
                          modify({ ...document, roomOverrides: next });
                        }}
                      />
                      Customize {category.name}
                    </label>
                    {document.roomOverrides[categoryId] ? (
                      <PolicyEditor
                        policy={categoryPolicy}
                        update={(value) =>
                          modify({
                            ...document,
                            roomOverrides: { ...document.roomOverrides, [categoryId]: value },
                          })
                        }
                        currency={currency}
                      />
                    ) : (
                      <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-2">
                        Inherited from property defaults.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <p className="mb-3 text-sm text-ink-2">
                  Enter one room per line as <strong>code, optional name</strong>. For example: 101,
                  Lotus. Codes are unique within a property.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    Category
                    <select
                      aria-label="Bulk room category"
                      value={bulkCategoryId}
                      onChange={(event) => {
                        setBulkCategoryId(event.target.value);
                        setBulkReview(null);
                      }}
                      className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
                    >
                      {configuration.categories.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold">
                    Floor
                    <Input
                      value={bulkFloor}
                      onChange={(event) => {
                        setBulkFloor(event.target.value);
                        setBulkReview(null);
                      }}
                      placeholder="Optional floor"
                    />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-semibold">
                  Rooms
                  <textarea
                    value={bulkText}
                    onChange={(event) => {
                      setBulkText(event.target.value);
                      setBulkReview(null);
                    }}
                    rows={8}
                    className="mt-1 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm"
                    placeholder={'101, Lotus\n102, Jasmine'}
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={reviewBulk}
                    disabled={busy || !bulkUnits.length || bulkUnits.length > 200}
                  >
                    Review {bulkUnits.length} rooms
                  </Button>
                  <Button onClick={saveBulk} disabled={busy || !bulkReview?.valid}>
                    Save reviewed rooms
                  </Button>
                </div>
                {bulkReview && (
                  <div className="mt-3 rounded-lg border border-line p-3 text-sm">
                    {bulkReview.valid
                      ? `${bulkReview.count} rooms ready to save.`
                      : bulkReview.issues.map((issue) => (
                          <p key={`${issue.index}-${issue.field}`}>
                            Line {issue.index + 1}: {issue.message}
                          </p>
                        ))}
                    {bulkReview.valid && (
                      <ul className="mt-2 max-h-40 overflow-auto">
                        {bulkUnits.map((unit, index) => (
                          <li key={index}>
                            {unit.code}
                            {unit.displayName ? ` · ${unit.displayName}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <p className="mb-3 text-sm text-ink-2">
                  Review each existing guest rate explicitly. Occupancy labels do not establish
                  adult or child counts.
                </p>
                {configuration.rates.map((option) => {
                  const rate = document.rates[option.id];
                  return (
                    <div key={option.id} className="mb-3 rounded-lg border border-line p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <strong className="text-sm text-ink">
                          {configuration.categories.find((item) => item.id === option.roomId)?.name}{' '}
                          · {option.code} · {option.label} · {option.audience}
                        </strong>
                        {!rate && (
                          <Button
                            size="sm"
                            onClick={() =>
                              modify({
                                ...document,
                                rates: {
                                  ...document.rates,
                                  [option.id]: {
                                    roomId: option.roomId,
                                    baseOccupancyId: option.id,
                                    includedAdults: document.defaults.includedAdults,
                                    includedChildren: document.defaults.includedChildren,
                                    meal: {
                                      code: option.code as 'RO' | 'BB' | 'HB' | 'FB' | 'AI',
                                      mode: option.code === 'RO' ? 'derived' : 'independent',
                                      adultMealMinor: 0,
                                      childMeals: Object.fromEntries(
                                        (
                                          document.roomOverrides[option.roomId] ?? document.defaults
                                        ).childBands.map((band) => [
                                          band.id,
                                          { mode: 'fixed', amountMinor: 0 },
                                        ]),
                                      ),
                                      minimumNetMinor: 0,
                                    },
                                  },
                                },
                              })
                            }
                          >
                            Configure
                          </Button>
                        )}
                      </div>
                      {rate && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <NumberField
                            label="Adults included"
                            value={rate.includedAdults}
                            onChange={(v) =>
                              modify({
                                ...document,
                                rates: {
                                  ...document.rates,
                                  [option.id]: { ...rate, includedAdults: v },
                                },
                              })
                            }
                          />
                          <NumberField
                            label="Children included"
                            value={rate.includedChildren}
                            onChange={(v) =>
                              modify({
                                ...document,
                                rates: {
                                  ...document.rates,
                                  [option.id]: { ...rate, includedChildren: v },
                                },
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {step === 4 && (
              <div className="space-y-3">
                {configuration.rates
                  .filter((option) => !!document.rates[option.id])
                  .map((option) => {
                    const rate = document.rates[option.id]!;
                    const bands = (document.roomOverrides[option.roomId] ?? document.defaults)
                      .childBands;
                    const setRate = (changes: Partial<typeof rate>) =>
                      modify({
                        ...document,
                        rates: { ...document.rates, [option.id]: { ...rate, ...changes } },
                      });
                    const roOptions = configuration.rates.filter(
                      (item) =>
                        item.roomId === option.roomId &&
                        item.audience === option.audience &&
                        item.code === 'RO',
                    );
                    return (
                      <details key={option.id} className="rounded-lg border border-line p-3">
                        <summary className="cursor-pointer text-sm font-bold">
                          {option.code} · {option.label} · {option.audience}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <label className="block text-xs font-semibold">
                            Pricing mode
                            <select
                              value={rate.meal.mode}
                              onChange={(event) => {
                                const mode = event.target.value as 'derived' | 'independent';
                                setRate({
                                  baseOccupancyId:
                                    mode === 'independent'
                                      ? option.id
                                      : (roOptions[0]?.id ?? option.id),
                                  meal: { ...rate.meal, mode },
                                });
                              }}
                              className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
                            >
                              <option value="derived">RO accommodation + meals</option>
                              <option value="independent">Independent plan price</option>
                            </select>
                          </label>
                          {rate.meal.mode === 'derived' && (
                            <label className="block text-xs font-semibold">
                              RO base occupancy
                              <select
                                value={rate.baseOccupancyId}
                                onChange={(event) =>
                                  setRate({ baseOccupancyId: event.target.value })
                                }
                                className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
                              >
                                {roOptions.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2">
                            <NumberField
                              label={`Adult meal supplement (${currency})`}
                              value={rate.meal.adultMealMinor}
                              money
                              onChange={(v) =>
                                setRate({ meal: { ...rate.meal, adultMealMinor: v } })
                              }
                            />
                            <NumberField
                              label={`Minimum hotel net room + meal (${currency})`}
                              value={rate.meal.minimumNetMinor}
                              money
                              onChange={(v) =>
                                setRate({ meal: { ...rate.meal, minimumNetMinor: v } })
                              }
                            />
                          </div>
                          {option.code !== 'RO' &&
                            bands.map((band) => (
                              <SupplementFields
                                key={band.id}
                                label={`${band.label} meal`}
                                value={
                                  rate.meal.childMeals[band.id] ?? { mode: 'fixed', amountMinor: 0 }
                                }
                                onChange={(value) =>
                                  setRate({
                                    meal: {
                                      ...rate.meal,
                                      childMeals: { ...rate.meal.childMeals, [band.id]: value },
                                    },
                                  })
                                }
                              />
                            ))}
                        </div>
                      </details>
                    );
                  })}
              </div>
            )}
            {step === 5 && (
              <>
                <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink-2">
                  <p>
                    <strong>Draft version:</strong> {version || 'not saved'} ·{' '}
                    <strong>Live version:</strong>{' '}
                    {configuration.policy?.publishedVersion ?? 'legacy pricing'}
                  </p>
                  <p className="mt-1">
                    Publishing applies these policies to new PMS quotes. Confirmed stays keep their
                    agreed prices. The current channel adapter cannot publish these policies;
                    outgoing channel rate updates will be blocked.
                  </p>
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={acknowledgeChannelLimit}
                    onChange={(event) => setAcknowledgeChannelLimit(event.target.checked)}
                  />
                  I have reviewed these rules and understand that channel rate publishing is
                  unavailable for this policy.
                </label>
                <Button
                  className="mt-3"
                  onClick={publish}
                  disabled={
                    busy || dirty || !version || issues.length > 0 || !acknowledgeChannelLimit
                  }
                >
                  Publish reviewed PMS policy
                </Button>
                <h3 className="mt-5 mb-2 text-base font-bold text-ink">Try a booking</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs font-semibold">
                    Guest rate
                    <select
                      value={book.occupancyId}
                      onChange={(event) => setBook({ ...book, occupancyId: event.target.value })}
                      className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
                    >
                      {configuration.rates.map((rate) => (
                        <option key={rate.id} value={rate.id}>
                          {rate.code} · {rate.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold">
                    Arrival
                    <Input
                      type="date"
                      value={book.checkin}
                      onChange={(event) => setBook({ ...book, checkin: event.target.value })}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Departure
                    <Input
                      type="date"
                      value={book.checkout}
                      onChange={(event) => setBook({ ...book, checkout: event.target.value })}
                    />
                  </label>
                  <NumberField
                    label="Adults"
                    value={book.adults}
                    onChange={(v) => setBook({ ...book, adults: v })}
                  />
                  <label className="text-xs font-semibold">
                    Child ages, separated by commas
                    <Input
                      placeholder="4, 11"
                      value={book.ages}
                      onChange={(event) => setBook({ ...book, ages: event.target.value })}
                    />
                  </label>
                  <NumberField
                    label="Extra beds"
                    value={book.extraBeds}
                    onChange={(v) => setBook({ ...book, extraBeds: v })}
                  />
                  <NumberField
                    label="Cots"
                    value={book.cots}
                    onChange={(v) => setBook({ ...book, cots: v })}
                  />
                </div>
                <Button
                  className="mt-3"
                  onClick={tryBooking}
                  disabled={
                    busy ||
                    dirty ||
                    !version ||
                    !book.occupancyId ||
                    !book.checkin ||
                    !book.checkout
                  }
                >
                  Calculate saved draft
                </Button>
                {quote && (
                  <div
                    aria-live="polite"
                    className="mt-4 space-y-2 rounded-lg border border-line p-3 text-sm"
                  >
                    <strong>
                      {quote.eligible ? 'Eligible' : 'Needs attention'} · {currency}{' '}
                      {moneyInput(quote.guestTotalMinor)} guest total ·{' '}
                      {moneyInput(quote.totalNetMinor)} hotel net
                    </strong>
                    {quote.issues.map((issue, index) => (
                      <p key={index} className="text-closed-ink">
                        {issue.field}: {issue.message}
                      </p>
                    ))}
                    {quote.nights.map(
                      (night) =>
                        night.quote && (
                          <div key={night.date} className="border-t border-line pt-2">
                            <strong>
                              {night.date} · {currency} {moneyInput(night.quote.totalNetMinor)}{' '}
                              hotel net
                            </strong>
                            {night.quote.lines.map((line, index) => (
                              <p key={index} className="flex justify-between">
                                <span>{line.label}</span>
                                <span>{moneyInput(line.amountMinor)}</span>
                              </p>
                            ))}
                            <p>
                              Room and meal minimum: {moneyInput(night.quote.minimumNetMinor)}{' '}
                              {night.quote.belowMinimum ? '· Below floor' : ''}
                            </p>
                            {night.economics && (
                              <>
                                <p className="flex justify-between">
                                  <span>YoHo commission</span>
                                  <span>{moneyInput(night.economics.commissionMinor)}</span>
                                </p>
                                <p className="flex justify-between">
                                  <span>Channel margin</span>
                                  <span>{moneyInput(night.economics.channelMarginMinor)}</span>
                                </p>
                                <p className="flex justify-between">
                                  <span>Taxes</span>
                                  <span>{moneyInput(night.economics.taxesMinor)}</span>
                                </p>
                                <p className="flex justify-between font-bold">
                                  <span>Guest total</span>
                                  <span>{moneyInput(night.economics.guestTotalMinor)}</span>
                                </p>
                              </>
                            )}
                          </div>
                        ),
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
          {issues.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-bold text-ink">
                Items to resolve before publishing ({issues.length})
              </h3>
              <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs text-closed-ink">
                {issues.map((issue, index) => (
                  <li key={index}>
                    {issue.field}: {issue.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
            >
              Previous
            </Button>
            <p aria-live="polite" className="text-sm text-ink-2">
              {message}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={save} disabled={busy}>
                Save draft
              </Button>
              <Button
                onClick={() => setStep(Math.min(steps.length - 1, step + 1))}
                disabled={step === steps.length - 1}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
