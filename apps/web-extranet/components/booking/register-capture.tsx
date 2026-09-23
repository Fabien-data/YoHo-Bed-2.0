'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { IdentificationCard } from '@phosphor-icons/react';
import { idTypesFor, ID_DOCUMENT_LABELS, type IdDocumentType } from '@yohobed/locale';
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@yohobed/ui';
import { addGuestDocument, describeError, saveStayRegistration, updateCustomer } from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';

/**
 * Malaysia's guest register at check-in (Development Phase 02, Sprint 7): only the fields the
 * register still lacks, filled in without leaving the dialog. The server names what is missing
 * (the Registration of Guests Act 1965 list); this asks for exactly that and nothing more.
 */
export function RegisterCapture({
  bookingId,
  customerId,
  message,
  missing,
  onSaved,
}: {
  bookingId: string;
  customerId: string;
  message: string;
  missing: string[];
  onSaved: () => void;
}) {
  const { property } = useActiveProperty();
  const needs = (label: string) => missing.includes(label);
  const types = idTypesFor(property?.countryCode);
  const [f, setF] = React.useState({
    address: '',
    occupation: '',
    gender: '' as '' | 'male' | 'female' | 'other',
    docType: types[0]! as IdDocumentType,
    docNumber: '',
    placeOfIssue: '',
    issuedOn: '',
    arrivedFrom: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const needsDocument =
    needs('ID or passport number') || needs('Place of issue') || needs('Date of issue');

  const save = useMutation({
    mutationFn: async () => {
      const profile = {
        ...(needs('Address') && { address: f.address.trim() }),
        ...(needs('Occupation') && { occupation: f.occupation.trim() }),
        ...(needs('Sex') && f.gender && { gender: f.gender }),
      };
      if (Object.keys(profile).length) await updateCustomer(customerId, profile);
      if (needsDocument) {
        await addGuestDocument(customerId, {
          type: f.docType,
          number: f.docNumber.trim(),
          placeOfIssue: f.placeOfIssue.trim() || undefined,
          issuedOn: f.issuedOn || undefined,
          isPrimary: true,
        });
      }
      if (needs('Arrived from')) {
        await saveStayRegistration(bookingId, { arrivedFrom: f.arrivedFrom.trim() });
      }
    },
    onSuccess: onSaved,
  });

  const complete =
    (!needs('Address') || f.address.trim()) &&
    (!needs('Occupation') || f.occupation.trim()) &&
    (!needs('Sex') || f.gender) &&
    (!needsDocument || (f.docNumber.trim() && f.placeOfIssue.trim() && f.issuedOn)) &&
    (!needs('Arrived from') || f.arrivedFrom.trim());

  return (
    <div className="rounded-lg border border-low bg-low-soft p-3">
      <p className="mb-3 flex items-start gap-2 text-sm text-low-ink">
        <IdentificationCard size={16} className="mt-0.5 shrink-0" /> {message}
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (complete) save.mutate();
        }}
      >
        {needs('Address') && (
          <Field label="Address" className="sm:col-span-2">
            <Input value={f.address} onChange={set('address')} autoComplete="off" />
          </Field>
        )}
        {needs('Occupation') && (
          <Field label="Occupation">
            <Input value={f.occupation} onChange={set('occupation')} />
          </Field>
        )}
        {needs('Sex') && (
          <Field label="Sex">
            <Select value={f.gender} onValueChange={(v) => setF({ ...f, gender: v as 'male' })}>
              <SelectTrigger aria-label="Sex">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        {needsDocument && (
          <>
            <Field label="Document">
              <Select
                value={f.docType}
                onValueChange={(v) => setF({ ...f, docType: v as IdDocumentType })}
              >
                <SelectTrigger aria-label="Document type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ID_DOCUMENT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Number">
              <Input
                aria-label="Document number"
                value={f.docNumber}
                onChange={set('docNumber')}
                autoComplete="off"
              />
            </Field>
            <Field label="Place of issue">
              <Input value={f.placeOfIssue} onChange={set('placeOfIssue')} />
            </Field>
            <Field label="Date of issue">
              <Input type="date" value={f.issuedOn} onChange={set('issuedOn')} />
            </Field>
          </>
        )}
        {needs('Arrived from') && (
          <Field label="Arrived from" hint="The last city or country before the hotel">
            <Input value={f.arrivedFrom} onChange={set('arrivedFrom')} />
          </Field>
        )}
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" size="sm" loading={save.isPending} disabled={!complete}>
            Save to the register
          </Button>
        </div>
      </form>
      {save.isError && <p className="mt-2 text-sm text-closed-ink">{describeError(save.error)}</p>}
    </div>
  );
}
