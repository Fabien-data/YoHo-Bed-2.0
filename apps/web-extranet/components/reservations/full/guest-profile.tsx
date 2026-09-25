'use client';

import * as React from 'react';
import {
  CountrySelect,
  DatePicker,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@yohobed/ui';
import { ID_DOCUMENT_LABELS, idTypesFor, subdivisionsOf } from '@yohobed/locale';
import type { IdDocumentType } from '@/lib/api';
import { SlipAttach } from '@/components/payments/payment-fields';
import type { GuestProfileDraft } from './full-draft';

/**
 * The rest of Yanolja's Guest Information block — address, zip, country → state → city — plus
 * the guest's nationality, which makes them a resident or a foreigner. That decides the rates
 * offered (and, in Malaysia and India, tourism tax and Form C), so it is read from the nationality
 * alone: the desk no longer picks "Rates for" by hand (owner brief, 2026-09-26).
 */
export function GuestProfileFields({
  value,
  onChange,
  audienceRates,
}: {
  value: GuestProfileDraft;
  onChange: (next: GuestProfileDraft) => void;
  /** The hotel sells resident-only or foreign-only rates, so the nationality matters now. */
  audienceRates?: boolean;
}) {
  const set = (patch: Partial<GuestProfileDraft>) => onChange({ ...value, ...patch });
  const linked = value.customerId !== null;
  const states = subdivisionsOf(value.countryCode);

  if (linked) {
    return (
      <p className="text-sm text-ink-3">
        Address and nationality come from the guest&apos;s profile.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Field label="Address" htmlFor="guest-address">
        <Input
          id="guest-address"
          autoComplete="off"
          placeholder="Address"
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]">
        <Field label="Zip" htmlFor="guest-zip">
          <Input
            id="guest-zip"
            autoComplete="off"
            placeholder="Zip"
            value={value.zip}
            onChange={(e) => set({ zip: e.target.value })}
          />
        </Field>
        <Field label="Country" htmlFor="guest-country">
          <CountrySelect
            id="guest-country"
            aria-label="Country"
            value={value.countryCode || null}
            onChange={(countryCode) => set({ countryCode: countryCode ?? '', state: '' })}
          />
        </Field>
        <Field label="State" htmlFor="guest-state">
          {states.length > 0 ? (
            <Select value={value.state || undefined} onValueChange={(state) => set({ state })}>
              <SelectTrigger id="guest-state" aria-label="State">
                <SelectValue placeholder="-Select-" />
              </SelectTrigger>
              <SelectContent>
                {states.map((st) => (
                  <SelectItem key={st.code} value={st.name}>
                    {st.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="guest-state"
              autoComplete="off"
              placeholder="State"
              value={value.state}
              onChange={(e) => set({ state: e.target.value })}
            />
          )}
        </Field>
        <Field label="City" htmlFor="guest-city">
          <Input
            id="guest-city"
            autoComplete="off"
            placeholder="City"
            value={value.city}
            onChange={(e) => set({ city: e.target.value })}
          />
        </Field>
      </div>
      <Field
        label="Nationality"
        htmlFor="guest-nationality"
        className="md:max-w-sm"
        hint={audienceRates ? 'Resident and foreign rates follow the nationality.' : undefined}
      >
        <CountrySelect
          id="guest-nationality"
          aria-label="Nationality"
          value={value.nationalityCode || null}
          onChange={(nationalityCode) => set({ nationalityCode: nationalityCode ?? '' })}
        />
      </Field>
    </div>
  );
}

/** The ID document looked at: type, number, passport expiry and a scan (never for Aadhaar). */
export function GuestDocumentFields({
  value,
  onChange,
  propertyCountry,
  today,
}: {
  value: GuestProfileDraft;
  onChange: (next: GuestProfileDraft) => void;
  propertyCountry: string;
  today: string;
}) {
  const setDoc = (patch: Partial<GuestProfileDraft['document']>) =>
    onChange({ ...value, document: { ...value.document, ...patch } });
  const docTypes = idTypesFor(propertyCountry, value.nationalityCode || null);
  const docType = value.document.type;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
      <Field label="Document type" htmlFor="guest-doc-type">
        <Select
          value={docType || undefined}
          onValueChange={(type) =>
            setDoc({
              type: type as IdDocumentType,
              issuingCountry:
                type === 'passport' ? value.nationalityCode || value.document.issuingCountry : '',
            })
          }
        >
          <SelectTrigger id="guest-doc-type" aria-label="ID document type">
            <SelectValue placeholder="-Select-" />
          </SelectTrigger>
          <SelectContent>
            {docTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {ID_DOCUMENT_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Document number"
        htmlFor="guest-doc-number"
        hint={docType === 'aadhaar' ? 'Only the last 4 digits are kept.' : undefined}
      >
        <Input
          id="guest-doc-number"
          autoComplete="off"
          disabled={!docType}
          inputMode={docType === 'aadhaar' ? 'numeric' : undefined}
          maxLength={docType === 'aadhaar' ? 14 : 40}
          placeholder={docType === 'aadhaar' ? 'Last 4 digits' : 'Number'}
          value={value.document.number}
          onChange={(e) => setDoc({ number: e.target.value })}
        />
      </Field>
      {docType === 'passport' && (
        <Field label="Passport expiry" htmlFor="guest-doc-expiry">
          <DatePicker
            id="guest-doc-expiry"
            aria-label="Passport expiry"
            value={value.document.expiresOn || null}
            today={today}
            min={today}
            onChange={(expiresOn) => setDoc({ expiresOn })}
          />
        </Field>
      )}
      {/* UIDAI forbids keeping a copy of an Aadhaar card, so it never gets a scan. */}
      {docType && docType !== 'aadhaar' && (
        <SlipAttach
          label="Scan"
          purpose="id_document"
          file={value.document.file}
          onChange={(file) => setDoc({ file })}
        />
      )}
    </div>
  );
}

/** What a complete guest record needs at this desk, and what is still missing. */
export function guestInfoMissing(g: GuestProfileDraft): string[] {
  if (g.customerId) return [];
  const missing: string[] = [];
  if (!g.name.trim()) missing.push('name');
  if (!g.phone.number.trim() && !g.email.trim()) missing.push('phone or email');
  if (!g.nationalityCode) missing.push('nationality');
  return missing;
}

/** An ID document is recorded when both its type and its number are given. */
export function documentGiven(g: GuestProfileDraft): boolean {
  return Boolean(g.document.type && g.document.number.trim());
}
