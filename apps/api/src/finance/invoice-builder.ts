import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';
import {
  bookingDays,
  bookingInclusions,
  bookingRooms,
  bookingTransfers,
  bookings,
  customers,
  exchangeRates,
  folioCharges,
  folios,
  ledgerAccounts,
  properties,
  type Tx,
} from '@yohobed/db';
import {
  isResidency,
  roundMoney,
  scaleTaxLines,
  splitProportional,
  sumMoney,
  vatOf,
  type InvoiceParty,
  type TaxLine,
} from '@yohobed/domain';
import { ConflictException } from '@nestjs/common';
import { levyEstimate } from '../folio/levies';

/**
 * What goes on a document (Development Phase 02, Sprint 6), read from the folio — never recomputed.
 *
 * A room line carries its night's tax split from `booking_days.tax_lines` (the pricer wrote it
 * when the booking was made), scaled to the rooms, so an invoice's taxes add up to the stored tax
 * to the cent. Any other line with tax gets one line at its own rate. The builder only reads; the
 * service numbers, snapshots and writes.
 */

export interface BuiltLine {
  description: string;
  quantity: number;
  /** Per unit, taxes included. */
  unitPrice: number;
  amount: number;
  net: number;
  tax: number;
  taxLines: TaxLine[];
  postedFor: string | null;
  folioChargeId: string | null;
  /** Where the line came from: room nights get India's SAC code; a levy prints its number. */
  source?: 'room' | 'manual' | 'pos' | 'inclusion' | 'levy' | null;
  /** India's HSN/SAC code for the line (Sprint 7). */
  hsnSac?: string | null;
}

type Property = typeof properties.$inferSelect;
type Booking = typeof bookings.$inferSelect;
type Folio = typeof folios.$inferSelect;

/** Make a line's tax lines add up to its tax exactly (the cents of a scaled split can drift). */
function reconcile(lines: TaxLine[], tax: number): TaxLine[] {
  if (lines.length === 0) return lines;
  if (sumMoney(lines.map((l) => l.amount)) === roundMoney(tax)) return lines;
  const parts = splitProportional(
    tax,
    lines.map((l) => l.amount),
  );
  return lines.map((l, i) => ({ ...l, amount: parts[i]! }));
}

/** One tax line for a charge that has a tax but no split: its whole tax, at its own rate. */
function singleTax(net: number, tax: number, country: string): TaxLine[] {
  if (tax <= 0) return [];
  return [
    {
      key: 'charge_tax',
      // A Sri Lankan extra's tax is VAT; elsewhere it is named when Sprint 7 brings the engine.
      name: country === 'LK' ? 'VAT' : 'Tax',
      priority: 3,
      // To a tenth of a percent: a cent-rounded split of 18% reads back as 0.17999…
      rate: net > 0 ? Math.round((tax / net) * 1000) / 1000 : 0,
      amount: roundMoney(tax),
      exemptible: false,
    },
  ];
}

async function nightTaxes(tx: Tx, bookingId: string) {
  const days = await tx
    .select({
      date: bookingDays.date,
      sellingPrice: bookingDays.sellingPrice,
      tax: bookingDays.tax,
      taxLines: bookingDays.taxLines,
    })
    .from(bookingDays)
    .where(eq(bookingDays.bookingId, bookingId))
    .orderBy(asc(bookingDays.date));
  return days;
}

/** The lines of a folio window: every live charge on it, in the order the bill shows them. */
export async function folioLines(
  tx: Tx,
  folio: Folio,
  booking: Booking,
  country: string,
): Promise<BuiltLine[]> {
  const charges = await tx
    .select()
    .from(folioCharges)
    .where(and(eq(folioCharges.folioId, folio.id), isNull(folioCharges.voidedAt)))
    .orderBy(asc(folioCharges.postedFor), asc(folioCharges.createdAt));
  const nights = new Map((await nightTaxes(tx, booking.id)).map((d) => [d.date, d]));

  const out: BuiltLine[] = charges.map((c) => {
    const quantity = Number(c.quantity);
    const tax = Number(c.tax);
    const amount = Number(c.total);
    let lines: TaxLine[];
    if (c.taxLines?.length) {
      lines = c.taxLines;
    } else if (c.source === 'room') {
      const night = nights.get(c.bookingDate ?? c.postedFor);
      lines = night?.taxLines?.length
        ? scaleTaxLines(night.taxLines, quantity)
        : singleTax(amount - tax, tax, country);
    } else {
      lines = singleTax(amount - tax, tax, country);
    }
    return {
      description: c.description,
      quantity,
      unitPrice: Number(c.unitPrice),
      amount,
      net: roundMoney(amount - tax),
      tax,
      taxLines: reconcile(lines, tax),
      postedFor: c.postedFor,
      folioChargeId: c.id,
      source: c.source,
    };
  });

  // Window 1 of a stay whose room charges were never posted (a Starter hotel has no night audit):
  // the rooms come from the booking's own nights, exactly as the folio would have posted them.
  if (folio.window === 1) {
    const [posted] = await tx
      .select({ id: folioCharges.id })
      .from(folioCharges)
      .innerJoin(folios, eq(folios.id, folioCharges.folioId))
      .where(and(eq(folios.bookingId, booking.id), eq(folioCharges.source, 'room')))
      .limit(1);
    if (!posted) out.unshift(...roomNightLines([...nights.values()], booking, country));
  }
  return out;
}

/** Room lines straight from the booking's nights: one per night, for all its rooms. */
export function roomNightLines(
  nights: Array<{ date: string; sellingPrice: string; tax: string; taxLines: TaxLine[] | null }>,
  booking: Pick<Booking, 'rooms'>,
  country: string,
): BuiltLine[] {
  return nights.map((d) => {
    const quantity = booking.rooms;
    const amount = roundMoney(Number(d.sellingPrice) * quantity);
    const tax = roundMoney(Number(d.tax) * quantity);
    const lines = d.taxLines?.length
      ? scaleTaxLines(d.taxLines, quantity)
      : singleTax(amount - tax, tax, country);
    return {
      description:
        quantity > 1 ? `Room charge — ${d.date} (${quantity} rooms)` : `Room charge — ${d.date}`,
      quantity,
      unitPrice: Number(d.sellingPrice),
      amount,
      net: roundMoney(amount - tax),
      tax,
      taxLines: reconcile(lines, tax),
      postedFor: d.date,
      folioChargeId: null,
      source: 'room' as const,
    };
  });
}

/**
 * A pro-forma's lines: what the stay will cost — its nights, the inclusions it will be charged
 * (by their rhythm, over the stay's pax) and the transfers booked. Nothing here is posted.
 */
export async function proformaLines(
  tx: Tx,
  booking: Booking,
  country: string,
): Promise<BuiltLine[]> {
  const lines = roomNightLines(await nightTaxes(tx, booking.id), booking, country);

  const [pax] = await tx
    .select({ adults: bookingRooms.adults, children: bookingRooms.children })
    .from(bookingRooms)
    .where(and(eq(bookingRooms.bookingId, booking.id), isNull(bookingRooms.releasedAt)));
  const adults = pax?.adults ?? 0;
  const children = pax?.children ?? 0;
  const nights = booking.nights;

  const inclusions = await tx
    .select()
    .from(bookingInclusions)
    .where(
      and(eq(bookingInclusions.bookingId, booking.id), eq(bookingInclusions.includedInRate, false)),
    )
    .orderBy(asc(bookingInclusions.createdAt));
  for (const inc of inclusions) {
    const quantity =
      inc.rhythm === 'once'
        ? 1
        : inc.rhythm === 'per_night'
          ? nights
          : inc.rhythm === 'per_guest_per_night'
            ? nights * (adults + children)
            : inc.rhythm === 'per_adult_per_night'
              ? nights * adults
              : nights * children;
    if (quantity <= 0) continue;
    const unit = roundMoney(Number(inc.unitPrice) * (1 - Number(inc.discountPct) / 100));
    const amount = roundMoney(unit * quantity);
    const rate = Number(inc.taxRatePct);
    const tax = roundMoney(rate > 0 ? amount - amount / (1 + rate / 100) : 0);
    lines.push({
      description: inc.name,
      quantity,
      unitPrice: unit,
      amount,
      net: roundMoney(amount - tax),
      tax,
      taxLines:
        tax > 0
          ? singleTax(amount - tax, tax, country).map((t) => ({ ...t, rate: rate / 100 }))
          : [],
      postedFor: null,
      folioChargeId: null,
    });
  }

  const transfers = await tx
    .select()
    .from(bookingTransfers)
    .where(eq(bookingTransfers.bookingId, booking.id))
    .orderBy(asc(bookingTransfers.createdAt));
  for (const t of transfers) {
    if (t.status === 'cancelled' || Number(t.amount) <= 0) continue;
    lines.push({
      description: t.direction === 'pickup' ? 'Pick-up' : 'Drop-off',
      quantity: 1,
      unitPrice: Number(t.amount),
      amount: Number(t.amount),
      net: Number(t.amount),
      tax: 0,
      taxLines: [],
      postedFor: null,
      folioChargeId: null,
    });
  }

  // Levies the stay will owe if stayed in full — Malaysia's tourism tax (Sprint 7).
  for (const levy of await levyEstimate(tx, {
    propertyId: booking.propertyId,
    currency: booking.currency,
    checkin: booking.checkin,
    checkout: booking.checkout,
    residency: isResidency(booking.residency) ? booking.residency : null,
    levyExempt: booking.levyExempt,
    collectedByChannel: booking.levyCollectedByChannel,
    rooms: booking.rooms,
  })) {
    lines.push({
      description: `${levy.name} (${levy.nights} night${levy.nights === 1 ? '' : 's'})`,
      quantity: roundMoney(levy.amount / levy.unit),
      unitPrice: levy.unit,
      amount: levy.amount,
      net: levy.amount,
      tax: 0,
      taxLines: [],
      postedFor: null,
      folioChargeId: null,
      source: 'levy',
    });
  }
  return lines;
}

/** Does this line carry VAT (a Sri Lankan tax invoice may only list those)? */
export function hasVat(line: BuiltLine): boolean {
  return vatOf(line.taxLines) > 0;
}

/** The hotel as it prints on the document. */
export function supplierOf(p: Property): InvoiceParty {
  const ids = p.taxIds ?? {};
  return {
    name: p.name,
    legalName: p.legalName,
    address: p.address,
    city: p.city,
    country: p.countryCode,
    phone: p.phone,
    email: p.email,
    taxId: ids.tin ?? ids.gstin ?? ids.sstNo ?? null,
    registrationNo: ids.sltdaRegNo ?? ids.brn ?? null,
    branchCode: p.branchCode,
    // Sprint 7: India's GST state code (place of supply) and Malaysia's Tourism Tax number.
    stateCode: p.stateCode,
    ttxNo: ids.ttxNo ?? null,
  };
}

/** Who the window bills, as it prints: its travel agent or company, else its guest. */
export async function payerOf(
  tx: Tx,
  folio: Folio | null,
  booking: Booking,
): Promise<InvoiceParty> {
  if (folio?.payerLedgerAccountId) {
    const [a] = await tx
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, folio.payerLedgerAccountId));
    if (a) {
      return {
        name: a.name,
        legalName: a.legalName,
        address: a.address,
        city: a.city,
        country: a.countryCode,
        phone: a.phone ?? a.mobile,
        email: a.email,
        taxId: a.taxId,
        registrationNo: a.registrationNo,
      };
    }
  }
  const customerId = folio?.payerCustomerId ?? booking.customerId;
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
  return {
    name: c?.name ?? 'Guest',
    legalName: c?.companyName ?? null,
    address: c?.address ?? null,
    city: c?.city ?? null,
    country: c?.countryCode ?? c?.country ?? null,
    phone: c?.phone ?? null,
    email: c?.email ?? null,
    taxId: c?.taxId ?? null,
  };
}

/** Merge what the desk typed at issue over the payer on file; blanks keep the file's value. */
export function withPayerOverrides(base: InvoiceParty, over?: Partial<InvoiceParty>): InvoiceParty {
  if (!over) return base;
  const out: InvoiceParty = { ...base };
  for (const [k, v] of Object.entries(over) as Array<
    [keyof InvoiceParty, string | null | undefined]
  >) {
    if (typeof v === 'string' && v.trim()) (out as unknown as Record<string, string>)[k] = v.trim();
  }
  return out;
}

/**
 * The rate to the local currency on the invoice date: the newest rate fetched before the end of
 * that day. A tax invoice in USD must show its LKR equivalents, so no rate is a refusal.
 */
export async function fxRateOn(
  tx: Tx,
  currency: string,
  quote: string,
  date: string,
): Promise<string> {
  if (currency === quote) return '1';
  const end = new Date(`${date}T23:59:59.999Z`);
  const [row] = await tx
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.base, currency),
        eq(exchangeRates.quote, quote),
        lt(exchangeRates.fetchedAt, end),
      ),
    )
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1);
  if (!row) {
    throw new ConflictException({
      reason: 'fx_rate_unavailable',
      message: `No ${currency}→${quote} rate is loaded for ${date}; a tax invoice must show its ${quote} amounts. Set a rate under Finance → Exchange rates.`,
    });
  }
  return row.rate;
}
