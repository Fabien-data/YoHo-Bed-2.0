'use client';

import * as React from 'react';
import {
  CountrySelect,
  DatePicker,
  Field,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@yohobed/ui';
import { ID_DOCUMENT_LABELS, countryName, idTypesFor, subdivisionsOf } from '@yohobed/locale';
import type { IdDocumentType, Residency } from '@/lib/api';
import { SlipAttach } from '@/components/payments/payment-fields';
import type { GuestProfileDraft } from './full-draft';

/**
 * The rest of Yanolja's Guest Information block — address, zip, country → state → city — plus
 * what a Sri Lankan, Malaysian or Indian desk also needs: nationality, which makes the guest a
 * resident or a foreigner (and so decides the rates offered and, later, tourism tax and Form C),
 * and the ID document looked at.
 */
export function GuestProfileFields({
  value,
  onChange,
  propertyCountry,
  residency,
  residencyManual,
  onResidency,
  today,
}: {
  value: GuestProfileDraft;
  onChange: (next: GuestProfileDraft) => void;
  propertyCountry: string;
  residency: Residency | null;
  residencyManual: boolean;
  onResidency: (r: Residency) => void;
  today: string;
}) {
  const set = (patch: Partial<GuestProfileDraft>) => onChange({ ...value, ...patch });
  const setDoc = (patch: Partial<GuestProfileDraft['document']>) =>
    onChange({ ...value, document: { ...value.document, ...patch } });
  const linked = value.customerId !== null;
  const states = subdivisionsOf(value.countryCode);
  const docTypes = idTypesFor(propertyCountry, value.nationalityCode || null);
  const docType = value.document.type;

  return (
    <div className="flex flex-col gap-3">
      {!linked && (
        <>
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
        </>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.2fr)_auto]">
        {!linked ? (
          <Field label="Nationality" htmlFor="guest-nationality">
            <CountrySelect
              id="guest-nationality"
              aria-label="Nationality"
              value={value.nationalityCode || null}
              onChange={(nationalityCode) => set({ nationalityCode: nationalityCode ?? '' })}
            />
          </Field>
        ) : (
          <p className="self-end pb-2 text-sm text-ink-3">
            Address and nationality come from the guest&apos;s profile.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Rates for</span>
          <SegmentedControl<Residency>
            aria-label="Resident or foreign guest"
            value={residency ?? 'local'}
            onChange={onResidency}
            options={[
              { value: 'local', label: `Resident (${countryName(propertyCountry)})` },
              { value: 'foreign', label: 'Foreign' },
            ]}
            className={residency === null ? 'opacity-70' : undefined}
          />
          <span className="text-[11px] text-ink-3">
            {residency === null
              ? 'All rates shown until the nationality is known.'
              : residencyManual
                ? 'Set by hand.'
                : 'From the nationality.'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Field label="ID document" htmlFor="guest-doc-type">
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
    </div>
  );
}
