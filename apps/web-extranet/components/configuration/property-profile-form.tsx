'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { countryList, presetFor, subdivisionsOf } from '@yohobed/locale';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import {
  geocodeAddress,
  updatePropertyProfile,
  uploadPropertyPhoto,
  listPropertyPhotos,
  mediaUrl,
  ApiError,
  type Property,
  type PropertyProfilePatch,
  type PropertyTaxIds,
} from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { NONE, errorMessage } from './shared';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const PROPERTY_TYPES = [
  'Hotel',
  'Resort',
  'Guesthouse',
  'Villa',
  'Apartment',
  'Hostel',
  'Other',
] as const;
const MAPS_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

/** Latitude and longitude when both are there and on the globe. */
function coordinatesOf(lat: string, lon: string): { lat: number; lon: number } | null {
  if (!lat.trim() || !lon.trim()) return null;
  const a = Number(lat);
  const o = Number(lon);
  return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180
    ? { lat: a, lon: o }
    : null;
}

/** OpenStreetMap's embeddable map, pinned — no key needed, so the map shows on every install. */
function osmEmbed({ lat, lon }: { lat: number; lon: number }): string {
  const box = [lon - 0.01, lat - 0.006, lon + 0.01, lat + 0.006].map((n) => n.toFixed(5)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** The registration numbers a hotel in each market prints on its documents. */
const TAX_FIELDS: Record<
  string,
  Array<{ key: keyof PropertyTaxIds; label: string; hint?: string }>
> = {
  LK: [
    { key: 'tin', label: 'TIN (VAT registration)', hint: '9 digits, printed on tax invoices' },
    { key: 'ssclRegNo', label: 'SSCL registration' },
    { key: 'sltdaRegNo', label: 'SLTDA registration' },
  ],
  MY: [
    { key: 'sstNo', label: 'SST registration no.' },
    { key: 'ttxNo', label: 'Tourism tax no.', hint: 'Printed beside the tourism tax line' },
    { key: 'brn', label: 'Business registration no. (BRN)' },
  ],
  IN: [{ key: 'gstin', label: 'GSTIN', hint: '15 characters' }],
};

interface Draft {
  name: string;
  legalName: string;
  code: string;
  propertyType: string;
  starRating: string;
  countryCode: string;
  stateCode: string;
  state: string;
  city: string;
  address: string;
  addressLine2: string;
  zip: string;
  phone: string;
  reservationPhone: string;
  email: string;
  website: string;
  fax: string;
  registrationNumber: string;
  additionalRegistrationNumbers: string[];
  latitude: string;
  longitude: string;
  timezone: string;
  checkinTime: string;
  checkoutTime: string;
  taxIds: Record<string, string>;
  branchCode: string;
  fyStartMonth: string;
  invoicePrefix: string;
}

function toDraft(p: Property): Draft {
  return {
    name: p.name,
    legalName: p.legalName ?? '',
    code: p.code ?? '',
    propertyType: p.propertyType ?? '',
    starRating: p.starRating == null ? NONE : String(p.starRating),
    countryCode: p.countryCode ?? 'LK',
    stateCode: p.stateCode ?? NONE,
    state: p.state ?? '',
    city: p.city ?? '',
    address: p.address ?? '',
    addressLine2: p.addressLine2 ?? '',
    zip: p.zip ?? '',
    phone: p.phone ?? '',
    reservationPhone: p.reservationPhone ?? '',
    email: p.email ?? '',
    website: p.website ?? '',
    fax: p.fax ?? '',
    registrationNumber: p.registrationNumber ?? '',
    additionalRegistrationNumbers: Array.from(
      { length: 4 },
      (_, i) => p.additionalRegistrationNumbers?.[i] ?? '',
    ),
    latitude: p.latitude == null ? '' : String(p.latitude),
    longitude: p.longitude == null ? '' : String(p.longitude),
    timezone: p.timezone ?? 'Asia/Colombo',
    checkinTime: (p.checkinTime ?? '14:00').slice(0, 5),
    checkoutTime: (p.checkoutTime ?? '11:00').slice(0, 5),
    taxIds: { ...(p.taxIds ?? {}) } as Record<string, string>,
    branchCode: p.branchCode ?? '',
    fyStartMonth: String(p.fyStartMonth ?? 4),
    invoicePrefix: p.invoicePrefix ?? '',
  };
}

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  const preferred = ['Asia/Colombo', 'Asia/Kuala_Lumpur', 'Asia/Kolkata'];
  const rest = all.filter((z) => !preferred.includes(z));
  const list = [...preferred, ...rest];
  return list.includes(current) ? list : [current, ...list];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5 first:pt-0 last:border-0 last:pb-0">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * The property's identity: what prints on registration cards and invoices, the operating times
 * that seed every reservation, and the country that selects the regional behaviour.
 */
export function PropertyProfileForm({
  property,
  canEdit,
  onSaved,
}: {
  property: Property;
  canEdit: boolean;
  onSaved?: (property: Property) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(property));
  const [mapMode, setMapMode] = React.useState<'address' | 'coordinates'>('address');
  const [logoBusy, setLogoBusy] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const logoInput = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    setDraft(toDraft(property));
    setMapMode('address');
  }, [property]);

  const photos = useQuery({
    queryKey: ['property-photos', property.id],
    queryFn: () => listPropertyPhotos(property.id),
  });
  const logo = photos.data?.find((photo) => photo.id === property.logoMediaId);

  const countries = React.useMemo(() => countryList(), []);
  const zones = React.useMemo(() => timezones(draft.timezone), [draft.timezone]);
  const states = subdivisionsOf(draft.countryCode);
  const taxFields = TAX_FIELDS[draft.countryCode] ?? TAX_FIELDS.LK!;
  const addressQuery =
    draft.address.trim() || draft.city.trim()
      ? [
          draft.address,
          draft.addressLine2,
          draft.city,
          states.find((s) => s.code === draft.stateCode)?.name ?? draft.state,
          draft.zip,
          countries.find((c) => c.code === draft.countryCode)?.name,
        ]
          .filter(Boolean)
          .join(', ')
      : '';
  const coordinateQuery = `${draft.latitude},${draft.longitude}`;
  const mapQuery = mapMode === 'coordinates' ? coordinateQuery : addressQuery;
  const mapsUrl = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;
  const pinned = coordinatesOf(draft.latitude, draft.longitude);
  const embedUrl =
    MAPS_EMBED_KEY && mapQuery
      ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_EMBED_KEY)}&q=${encodeURIComponent(mapQuery)}`
      : pinned
        ? osmEmbed(pinned)
        : null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const latitude = draft.latitude.trim() === '' ? null : Number(draft.latitude);
      const longitude = draft.longitude.trim() === '' ? null : Number(draft.longitude);
      if (
        (latitude === null) !== (longitude === null) ||
        (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      ) {
        throw new Error('Enter valid latitude and longitude together');
      }
      if (draft.website.trim()) {
        const website = new URL(draft.website.trim());
        if (!['http:', 'https:'].includes(website.protocol))
          throw new Error('Website must use http or https');
      }
      const original = toDraft(property);
      const taxIds: Record<string, string> = {};
      for (const f of Object.values(TAX_FIELDS).flat()) {
        const now = draft.taxIds[f.key]?.trim() ?? '';
        if (now !== (original.taxIds[f.key] ?? '')) taxIds[f.key] = now;
      }
      const body: PropertyProfilePatch = {
        name: draft.name.trim(),
        legalName: draft.legalName.trim() || null,
        code: draft.code.trim() || null,
        propertyType: (draft.propertyType || null) as PropertyProfilePatch['propertyType'],
        starRating: draft.starRating === NONE ? null : Number(draft.starRating),
        ...(draft.countryCode !== original.countryCode && { countryCode: draft.countryCode }),
        stateCode: states.length > 0 && draft.stateCode !== NONE ? draft.stateCode : null,
        state: states.length > 0 ? null : draft.state.trim() || null,
        city: draft.city.trim() || null,
        address: draft.address.trim() || null,
        addressLine2: draft.addressLine2.trim() || null,
        zip: draft.zip.trim() || null,
        phone: draft.phone.trim() || null,
        reservationPhone: draft.reservationPhone.trim() || null,
        email: draft.email.trim() || null,
        website: draft.website.trim() || null,
        fax: draft.fax.trim() || null,
        registrationNumber: draft.registrationNumber.trim() || null,
        additionalRegistrationNumbers: draft.additionalRegistrationNumbers.map((v) => v.trim()),
        latitude,
        longitude,
        timezone: draft.timezone,
        checkinTime: draft.checkinTime,
        checkoutTime: draft.checkoutTime,
        ...(Object.keys(taxIds).length > 0 && { taxIds }),
        branchCode: draft.branchCode.trim() || null,
        fyStartMonth: Number(draft.fyStartMonth),
        invoicePrefix: draft.invoicePrefix.trim() || null,
      };
      return updatePropertyProfile(property.id, body);
    },
    onSuccess: (updated) => {
      onSaved?.(updated);
      toast.success('Property profile saved');
      qc.invalidateQueries({ queryKey: queryKeys.properties });
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) =>
      toast.error(e instanceof Error && !(e instanceof ApiError) ? e.message : errorMessage(e)),
  });

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error('Hotel logo must be smaller than 1 MB');
      return;
    }
    setLogoBusy(true);
    try {
      const photo = await uploadPropertyPhoto(property.id, file);
      const updated = await updatePropertyProfile(property.id, { logoMediaId: photo.id });
      onSaved?.(updated);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.properties }),
        qc.invalidateQueries({ queryKey: ['property-photos', property.id] }),
      ]);
      toast.success('Hotel logo updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLogoBusy(false);
    }
  };

  const clearLogo = async () => {
    setLogoBusy(true);
    try {
      const updated = await updatePropertyProfile(property.id, { logoMediaId: null });
      onSaved?.(updated);
      await qc.invalidateQueries({ queryKey: queryKeys.properties });
      toast.success('Hotel logo removed');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLogoBusy(false);
    }
  };

  const locateCoordinates = () => {
    const lat = Number(draft.latitude);
    const lon = Number(draft.longitude);
    if (
      !draft.latitude.trim() ||
      !draft.longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      toast.error('Enter valid latitude and longitude to locate the property');
      return;
    }
    setMapMode('coordinates');
  };

  /** Yanolja's "Locate on Map": look the typed address up and pin it. */
  const findAddress = async () => {
    if (!addressQuery) {
      toast.error('Type the address first');
      return;
    }
    setFinding(true);
    try {
      const hits = await geocodeAddress(property.id, addressQuery);
      const hit = hits[0];
      if (!hit) {
        toast.error('That address is not on the map', {
          description: 'Try fewer words — the street and the city — or type the coordinates.',
        });
        return;
      }
      setDraft((d) => ({
        ...d,
        latitude: hit.latitude.toFixed(6),
        longitude: hit.longitude.toFixed(6),
      }));
      setMapMode('coordinates');
      toast.success('Found on the map', {
        description: `${hit.label}. Check the pin, then save the profile.`,
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFinding(false);
    }
  };

  const changeCountry = (code: string) => {
    setMapMode('address');
    const preset = presetFor(code);
    setDraft((d) => ({
      ...d,
      countryCode: code,
      stateCode: NONE,
      // Follow the market's usual timezone and invoice year when the country changes.
      ...(code === preset.country && {
        timezone: preset.timezone,
        fyStartMonth: String(preset.fyStartMonth),
      }),
    }));
  };

  return (
    <Card className="p-5">
      <fieldset disabled={!canEdit}>
        <Section title="General settings">
          <div className="sm:col-span-2 lg:col-span-3">
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(logo.storageKey)}
                  alt={`${property.name} logo`}
                  className="h-20 w-28 rounded-md object-contain"
                />
              ) : (
                <div className="flex h-20 w-28 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-ink-3">
                  No logo
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-ink">Hotel logo</p>
                <p className="mb-2 text-xs text-ink-3">JPEG, PNG or WebP, under 1 MB.</p>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void uploadLogo(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={logoBusy}
                      onClick={() => logoInput.current?.click()}
                    >
                      Upload logo
                    </Button>
                    {logo && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={logoBusy}
                        onClick={() => {
                          void clearLogo();
                        }}
                      >
                        Remove logo
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <Field label="Property name" required>
            <Input
              value={draft.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Registered business name" hint="Printed on tax invoices">
            <Input
              value={draft.legalName}
              maxLength={200}
              onChange={(e) => set('legalName', e.target.value)}
            />
          </Field>
          <Field label="Property code">
            <Input
              value={draft.code}
              maxLength={32}
              className="font-mono"
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label="Property type">
            <Select
              value={draft.propertyType || NONE}
              onValueChange={(v) => set('propertyType', v === NONE ? '' : v)}
            >
              <SelectTrigger aria-label="Property type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {PROPERTY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Star rating or grade">
            <Select value={draft.starRating} onValueChange={(v) => set('starRating', v)}>
              <SelectTrigger aria-label="Star rating or grade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not rated</SelectItem>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {n === 1 ? 'star' : 'stars'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Official email address">
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Primary contact number">
            <Input
              type="tel"
              value={draft.phone}
              maxLength={40}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="Reservation contact number">
            <Input
              type="tel"
              value={draft.reservationPhone}
              maxLength={40}
              onChange={(e) => set('reservationPhone', e.target.value)}
            />
          </Field>
          <Field label="Property website">
            <Input
              type="url"
              value={draft.website}
              placeholder="https://example.com"
              maxLength={300}
              onChange={(e) => set('website', e.target.value)}
            />
          </Field>
          <Field label="Fax number">
            <Input
              type="tel"
              value={draft.fax}
              maxLength={40}
              onChange={(e) => set('fax', e.target.value)}
            />
          </Field>
          <Field label="Primary registration number">
            <Input
              value={draft.registrationNumber}
              maxLength={80}
              onChange={(e) => set('registrationNumber', e.target.value)}
            />
          </Field>
          {draft.additionalRegistrationNumbers.map((value, index) => (
            <Field key={index} label={`Additional registration number ${index + 1}`}>
              <Input
                value={value}
                maxLength={80}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    additionalRegistrationNumbers: d.additionalRegistrationNumbers.map((n, i) =>
                      i === index ? e.target.value : n,
                    ),
                  }))
                }
              />
            </Field>
          ))}
        </Section>

        <Section title="Address information">
          <Field label="Street address (line 1)" className="sm:col-span-2">
            <Input
              value={draft.address}
              maxLength={300}
              onChange={(e) => {
                set('address', e.target.value);
                setMapMode('address');
              }}
            />
          </Field>
          <Field label="Street address (line 2)">
            <Input
              value={draft.addressLine2}
              maxLength={300}
              onChange={(e) => {
                set('addressLine2', e.target.value);
                setMapMode('address');
              }}
            />
          </Field>
          <Field
            label="Country"
            hint="Sets titles, ID types, taxes and invoice rules. Locked once the property has bookings."
          >
            <Select value={draft.countryCode} onValueChange={changeCountry}>
              <SelectTrigger aria-label="Country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {states.length > 0 ? (
            <Field label={draft.countryCode === 'LK' ? 'Province' : 'State'}>
              <Select
                value={draft.stateCode}
                onValueChange={(v) => {
                  set('stateCode', v);
                  setMapMode('address');
                }}
              >
                <SelectTrigger aria-label={draft.countryCode === 'LK' ? 'Province' : 'State'}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {states.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="State / region">
              <Input
                value={draft.state}
                maxLength={80}
                onChange={(e) => {
                  set('state', e.target.value);
                  setMapMode('address');
                }}
              />
            </Field>
          )}
          <Field label="City">
            <Input
              value={draft.city}
              maxLength={80}
              onChange={(e) => {
                set('city', e.target.value);
                setMapMode('address');
              }}
            />
          </Field>
          <Field label="Postal code">
            <Input
              value={draft.zip}
              maxLength={16}
              onChange={(e) => {
                set('zip', e.target.value);
                setMapMode('address');
              }}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            {embedUrl ? (
              <iframe
                key={embedUrl}
                title="Property location on the map"
                src={embedUrl}
                className="h-72 w-full rounded-lg border border-line"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-2 p-5 text-center">
                <p className="text-sm font-medium text-ink">Map</p>
                <p className="mt-1 max-w-md text-xs text-ink-3">
                  {addressQuery
                    ? 'Press “Locate on map” to pin the address, or type the coordinates.'
                    : 'Enter the property address or coordinates to locate it.'}
                </p>
              </div>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-info-ink hover:underline"
              >
                Open location in Google Maps
              </a>
            )}
          </div>
          <Field label="Latitude coordinates">
            <Input
              type="number"
              min={-90}
              max={90}
              step="any"
              value={draft.latitude}
              onChange={(e) => set('latitude', e.target.value)}
            />
          </Field>
          <Field label="Longitude coordinates">
            <Input
              type="number"
              min={-180}
              max={180}
              step="any"
              value={draft.longitude}
              onChange={(e) => set('longitude', e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                loading={finding}
                disabled={!addressQuery}
                onClick={() => void findAddress()}
              >
                Locate on map
              </Button>
            )}
            <Button type="button" variant="outline" onClick={locateCoordinates}>
              Use these coordinates
            </Button>
          </div>
          <Field label="Timezone" hint="The hotel's day — business dates and today follow it.">
            <Select value={draft.timezone} onValueChange={(v) => set('timezone', v)}>
              <SelectTrigger aria-label="Timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Operating times">
          <Field label="Check-in time" hint="Pre-filled on every new reservation">
            <Input
              type="time"
              value={draft.checkinTime}
              onChange={(e) => set('checkinTime', e.target.value)}
            />
          </Field>
          <Field label="Check-out time">
            <Input
              type="time"
              value={draft.checkoutTime}
              onChange={(e) => set('checkoutTime', e.target.value)}
            />
          </Field>
          <Field label="Base currency" hint="Set by YoHoBed when the property is onboarded">
            <Input value={property.currency ?? 'LKR'} disabled className="font-mono" />
          </Field>
        </Section>

        <Section title="Tax & invoicing">
          {taxFields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Input
                value={draft.taxIds[f.key] ?? ''}
                maxLength={30}
                className="font-mono uppercase"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, taxIds: { ...d.taxIds, [f.key]: e.target.value } }))
                }
              />
            </Field>
          ))}
          <Field label="Invoice prefix" hint="Letters, digits, / and -">
            <Input
              value={draft.invoicePrefix}
              maxLength={10}
              className="font-mono uppercase"
              onChange={(e) => set('invoicePrefix', e.target.value)}
            />
          </Field>
          {draft.countryCode === 'LK' && (
            <Field label="Branch code" hint="The branch part of the tax invoice number">
              <Input
                value={draft.branchCode}
                maxLength={15}
                className="font-mono uppercase"
                onChange={(e) => set('branchCode', e.target.value)}
              />
            </Field>
          )}
          <Field label="Financial year starts in">
            <Select value={draft.fyStartMonth} onValueChange={(v) => set('fyStartMonth', v)}>
              <SelectTrigger aria-label="Financial year starts in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      </fieldset>

      {canEdit && (
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button
            variant="outline"
            onClick={() => {
              setDraft(toDraft(property));
              setMapMode('address');
            }}
          >
            Reset
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft.name.trim()}
            onClick={() => save.mutate()}
          >
            Save profile
          </Button>
        </div>
      )}
    </Card>
  );
}
