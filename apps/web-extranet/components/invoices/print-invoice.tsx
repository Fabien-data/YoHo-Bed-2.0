'use client';

import * as React from 'react';
import { Printer } from '@phosphor-icons/react';
import { Button } from '@yohobed/ui';
import type { Invoice, InvoiceParty, InvoiceProfile } from '@/lib/api';
import { numberLocale } from '@/lib/format';

/** What the taxpayer number is called on this profile's documents. */
const TAX_ID_LABEL: Record<InvoiceProfile, string> = {
  lk_vat: 'TIN',
  in_gst: 'GSTIN',
  my_sst: 'SST No.',
  generic: 'Tax ID',
};

/**
 * A printed invoice, bill, pro-forma or credit note.
 *
 * Sri Lanka's Gazette 2481/22 decides the layout of a tax invoice: the heading "TAX INVOICE", the
 * supplier's TIN top-left and the purchaser's top-right, the serial, dates as MM/DD/YYYY, only
 * VAT-able supplies, and the LKR equivalent of a foreign-currency invoice at the day's rate.
 * India's GST invoice (Sprint 7) prints the supplier's and buyer's GSTIN, the place of supply, SAC
 * 996311, CGST + SGST and the rupee round-off; Malaysia's prints the SST number and the Tourism Tax
 * number beside its own line. Everything printed comes from the document's own snapshot, so a
 * reprint years later is identical.
 */

const isVat = (t: { priority: number; name: string }) =>
  t.priority === 3 || /\bvat\b/i.test(t.name);

function fmtDate(iso: string | null, profile: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return profile === 'lk_vat' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

function num(v: string | number | null | undefined, currency?: string): string {
  return Number(v ?? 0).toLocaleString(numberLocale(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Party({
  party,
  label,
  align,
  profile,
}: {
  party: InvoiceParty | null;
  label: string;
  align?: 'right';
  profile: InvoiceProfile;
}) {
  if (!party) return null;
  const lines = [
    party.legalName && party.legalName !== party.name ? party.legalName : null,
    party.address,
    [party.city, party.country].filter(Boolean).join(', ') || null,
    party.phone,
    party.email,
  ].filter(Boolean) as string[];
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="text-sm font-semibold text-ink">{party.name}</div>
      {lines.map((l, i) => (
        <div key={i} className="text-xs text-ink-2">
          {l}
        </div>
      ))}
      {party.taxId && (
        <div className="mt-1 font-mono text-xs font-semibold text-ink">
          {TAX_ID_LABEL[profile]} {party.taxId}
        </div>
      )}
      {party.registrationNo && (
        <div className="font-mono text-[11px] text-ink-2">Reg. {party.registrationNo}</div>
      )}
      {profile === 'in_gst' && party.stateCode && (
        <div className="font-mono text-[11px] text-ink-2">State code {party.stateCode}</div>
      )}
      {profile === 'my_sst' && party.ttxNo && (
        <div className="font-mono text-[11px] font-semibold text-ink">TTx No. {party.ttxNo}</div>
      )}
    </div>
  );
}

export function PrintInvoice({ invoice }: { invoice: Invoice }) {
  const lk = invoice.profile === 'lk_vat';
  const india = invoice.profile === 'in_gst';
  const cur = invoice.currency;
  const taxes = invoice.taxSummary ?? [];
  const vatTotal = taxes.filter(isVat).reduce((s, t) => s + Number(t.amount), 0);
  // Sri Lanka's value excludes only VAT; everyone else's excludes every tax.
  const exVat = lk ? Number(invoice.amount) - vatTotal : Number(invoice.subtotal ?? 0);
  const fx = invoice.fxRate ? Number(invoice.fxRate) : null;
  const local = (v: number) => (fx ? num(v * fx) : null);

  return (
    <div>
      <div className="mb-3 flex justify-end print:hidden">
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
      </div>

      <div id="invoice-doc" className="mx-auto max-w-[820px] bg-surface p-6 text-ink">
        <h1 className="text-center text-lg font-bold tracking-wide">{invoice.title}</h1>
        {invoice.kind === 'proforma' && (
          <p className="text-center text-[11px] text-ink-3">Not a tax invoice — a quotation.</p>
        )}

        <div className="mt-4 flex items-start justify-between gap-8 border-b border-line pb-4">
          <Party party={invoice.supplier} label="Supplier" profile={invoice.profile} />
          <Party party={invoice.payer} label="Purchaser" align="right" profile={invoice.profile} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
          <Meta label={lk ? 'Invoice no.' : 'Number'} value={invoice.number} mono />
          <Meta label="Invoice date" value={fmtDate(invoice.invoiceDate, invoice.profile)} />
          <Meta label="Date of supply" value={fmtDate(invoice.supplyDate, invoice.profile)} />
          <Meta label="Booking" value={invoice.booking?.reference ?? '—'} mono />
          {invoice.booking && (
            <Meta
              label="Stay"
              value={`${fmtDate(invoice.booking.checkin, invoice.profile)} → ${fmtDate(invoice.booking.checkout, invoice.profile)}`}
            />
          )}
          {invoice.original && (
            <Meta label="Against invoice" value={invoice.original.number} mono />
          )}
          {invoice.creditReason && <Meta label="Reason" value={invoice.creditReason} />}
          {india && <Meta label="Place of supply" value={invoice.placeOfSupply ?? '—'} mono />}
        </dl>

        <table className="mt-5 w-full text-xs">
          <thead>
            <tr className="border-y border-line-strong text-left">
              <th className="py-1.5">Description</th>
              {india && <th className="py-1.5">SAC</th>}
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Unit price</th>
              <th className="py-1.5 text-right">{lk ? 'Value (excl. VAT)' : 'Net'}</th>
              <th className="py-1.5 text-right">{lk ? 'VAT' : 'Tax'}</th>
              <th className="py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => {
              const vat = lk
                ? (l.taxLines ?? []).filter(isVat).reduce((s, t) => s + Number(t.amount), 0)
                : Number(l.tax ?? 0);
              const value = Number(l.amount) - vat;
              return (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-1.5">{l.description}</td>
                  {india && <td className="py-1.5 font-mono">{l.hsnSac ?? ''}</td>}
                  <td className="py-1.5 text-right font-mono tabular-nums">{Number(l.quantity)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {num(l.unitPrice, cur)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{num(value, cur)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{num(vat, cur)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{num(l.amount, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1 text-xs">
          <Total
            label={`Total value of supply (excl. ${lk ? 'VAT' : 'tax'})`}
            value={num(exVat, cur)}
            currency={invoice.currency}
          />
          {taxes.map((t) => (
            <Total
              key={`${t.key}-${t.rate}`}
              label={`${t.name} ${(t.rate * 100).toFixed((t.rate * 100) % 1 === 0 ? 0 : 2)}%`}
              value={num(t.amount, cur)}
              currency={invoice.currency}
              muted={lk && !isVat(t)}
            />
          ))}
          {Number(invoice.rounding) !== 0 && (
            <Total
              label={india ? 'Round off' : 'Rounding'}
              value={num(invoice.rounding, cur)}
              currency={invoice.currency}
              muted
            />
          )}
          <div className="mt-1 flex items-baseline gap-6 border-t border-line-strong pt-1 text-sm font-bold">
            <span>Total</span>
            <span className="font-mono tabular-nums">
              {invoice.currency} {num(invoice.amount, cur)}
            </span>
          </div>
          {fx && (
            <>
              <div className="mt-1 flex items-baseline gap-6 text-xs font-semibold">
                <span>Total in {invoice.fxQuote}</span>
                <span className="font-mono tabular-nums">
                  {invoice.fxQuote} {local(Number(invoice.amount))}
                </span>
              </div>
              <p className="text-[10px] text-ink-3">
                Converted at 1 {invoice.currency} = {Number(invoice.fxRate).toFixed(4)}{' '}
                {invoice.fxQuote} on {fmtDate(invoice.invoiceDate, invoice.profile)}.
              </p>
            </>
          )}
        </div>

        {invoice.notes && <p className="mt-4 text-xs text-ink-2">{invoice.notes}</p>}
        {invoice.creditedAt && invoice.kind !== 'credit_note' && (
          <p className="mt-4 text-xs font-semibold text-closed-ink">
            Cancelled by credit note {invoice.creditNotes[0]?.number ?? ''}.
          </p>
        )}
        <p className="mt-6 text-center text-[10px] text-ink-3">
          Computer-generated document. {lk ? 'Issued under Gazette 2481/22.' : ''}
          {india ? 'SAC 996311 — accommodation services.' : ''}
        </p>
      </div>

      {/* Print the document alone, in black on white, whatever the screen theme is. */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #invoice-doc,
          #invoice-doc * {
            visibility: visible;
            color: #000 !important;
            background: transparent !important;
          }
          #invoice-doc {
            position: absolute;
            inset: 0;
            padding: 24px;
          }
        }
      `}</style>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className={mono ? 'font-mono text-xs font-semibold' : 'text-xs'}>{value}</dd>
    </div>
  );
}

function Total({
  label,
  value,
  currency,
  muted,
}: {
  label: string;
  value: string;
  currency: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-baseline gap-6 ${muted ? 'text-ink-3' : 'text-ink-2'}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">
        {currency} {value}
      </span>
    </div>
  );
}
