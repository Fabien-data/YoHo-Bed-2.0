import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  bookingGroups,
  bookingRooms,
  bookings,
  customers,
  defaultTemplates,
  folioCharges,
  folios,
  messages,
  occupancies,
  payments,
  properties,
  rateCodes,
  ratePlans,
  roomUnits,
  rooms,
  templates,
  voucherTokens,
  type Tx,
} from '@yohobed/db';
import {
  CURRENCY_META,
  isCurrencyCode,
  renderTemplate,
  resolveReservationOptions,
} from '@yohobed/domain';
import { formatDate, formatTime } from '@yohobed/locale';

/**
 * The booking voucher (Development Phase 02, Sprint 6): what a reservation looks like to its
 * guest — every room of it, what it costs and what is paid — for the email, the WhatsApp message
 * and the guest booking page. One builder, so the three can never tell the guest different things.
 */

export interface VoucherRoom {
  reference: string;
  roomType: string;
  mealPlan: string | null;
  adults: number;
  children: number;
  roomCode: string | null;
  status: string;
}

export interface Voucher {
  tenantId: string;
  propertyId: string;
  bookingIds: string[];
  reference: string;
  status: string;
  guest: { id: string; name: string; email: string | null; mobileE164: string | null };
  property: {
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    checkinTime: string;
    checkoutTime: string;
  };
  checkin: string;
  checkout: string;
  arrivalTime: string | null;
  departureTime: string | null;
  nights: number;
  rooms: VoucherRoom[];
  currency: string;
  total: number;
  paid: number;
  balance: number;
  options: ReturnType<typeof resolveReservationOptions>;
}

/** The reservation a booking belongs to: its whole group when it was booked as one, else itself. */
export async function buildVoucher(tx: Tx, bookingId: string): Promise<Voucher | null> {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b) return null;
  let group: { id: string; code: string; kind: string } | undefined;
  if (b.groupId) {
    [group] = await tx
      .select({ id: bookingGroups.id, code: bookingGroups.code, kind: bookingGroups.kind })
      .from(bookingGroups)
      .where(eq(bookingGroups.id, b.groupId));
  }
  const siblings =
    group?.kind === 'reservation'
      ? await tx
          .select()
          .from(bookings)
          .where(eq(bookings.groupId, group.id))
          .orderBy(asc(bookings.siblingIndex), asc(bookings.reference))
      : [b];
  const ids = siblings.map((s) => s.id);

  const [guest] = await tx.select().from(customers).where(eq(customers.id, b.customerId));
  const [p] = await tx.select().from(properties).where(eq(properties.id, b.propertyId));

  const roomRows = await tx
    .select({
      bookingId: bookings.id,
      reference: bookings.reference,
      status: bookings.status,
      roomType: rooms.name,
      mealPlan: rateCodes.code,
      adults: bookingRooms.adults,
      children: bookingRooms.children,
      roomCode: roomUnits.code,
    })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .leftJoin(occupancies, eq(occupancies.id, bookings.occupancyId))
    .leftJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
    .leftJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
    .leftJoin(
      bookingRooms,
      and(eq(bookingRooms.bookingId, bookings.id), isNull(bookingRooms.releasedAt)),
    )
    .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
    .where(inArray(bookings.id, ids))
    .orderBy(asc(bookings.siblingIndex), asc(bookings.reference));

  // What the stay costs: the rooms at their sold price, plus anything else on the bills.
  const [extras] = await tx
    .select({
      total: sql<string>`coalesce(sum(${folioCharges.total}), 0)::text`,
    })
    .from(folioCharges)
    .innerJoin(folios, eq(folios.id, folioCharges.folioId))
    .where(
      and(
        inArray(folios.bookingId, ids),
        isNull(folioCharges.voidedAt),
        ne(folioCharges.source, 'room'),
      ),
    );
  const [paid] = await tx
    .select({
      total: sql<string>`coalesce(sum(case when ${payments.direction} = 'received' then ${payments.amount} else -${payments.amount} end), 0)::text`,
    })
    .from(payments)
    .where(inArray(payments.bookingId, ids));

  const live = siblings.filter((s) => s.status !== 'Cancelled' && s.status !== 'Rejected');
  const rooms_ = (live.length ? live : siblings).reduce(
    (s, x) => s + Number(x.amount) - Number(x.discount),
    0,
  );
  const total = Math.round((rooms_ + Number(extras?.total ?? 0)) * 100) / 100;
  const paidTotal = Number(paid?.total ?? 0);

  return {
    tenantId: b.tenantId,
    propertyId: b.propertyId,
    bookingIds: ids,
    reference: group?.kind === 'reservation' ? group.code : b.reference,
    status: live.length === 0 ? b.status : (live[0]!.status as string),
    guest: {
      id: guest!.id,
      name: guest!.name,
      email: guest!.email,
      mobileE164: guest!.mobileE164,
    },
    property: {
      name: p!.name,
      address: p!.address,
      city: p!.city,
      country: p!.countryCode,
      phone: p!.phone,
      email: p!.email,
      checkinTime: p!.checkinTime.slice(0, 5),
      checkoutTime: p!.checkoutTime.slice(0, 5),
    },
    checkin: b.checkin,
    checkout: b.checkout,
    arrivalTime: b.arrivalTime?.slice(0, 5) ?? null,
    departureTime: b.departureTime?.slice(0, 5) ?? null,
    nights: b.nights,
    rooms: roomRows.map((r) => ({
      reference: r.reference,
      roomType: r.roomType,
      mealPlan: r.mealPlan,
      adults: r.adults ?? 0,
      children: r.children ?? 0,
      roomCode: r.roomCode,
      status: r.status,
    })),
    currency: b.currency,
    total,
    paid: paidTotal,
    balance: Math.round((total - paidTotal) * 100) / 100,
    options: resolveReservationOptions(b.options),
  };
}

/** `Rs 24,390.25`, `$ 120.00`: an amount in its currency, for a guest to read. */
export function money(amount: number, currency: string): string {
  const symbol = isCurrencyCode(currency) ? CURRENCY_META[currency].symbol : currency;
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${n}`;
}

function roomLine(r: VoucherRoom, i: number): string {
  const pax = [
    `${r.adults} adult${r.adults === 1 ? '' : 's'}`,
    r.children ? `${r.children} child${r.children === 1 ? '' : 'ren'}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `${i + 1}. ${r.roomType}${r.mealPlan ? ` · ${r.mealPlan}` : ''} · ${pax}`;
}

/** The template variables of the voucher email. */
export function voucherVars(v: Voucher, link: string | null): Record<string, string | number> {
  const p = v.property;
  return {
    guestName: v.guest.name,
    reference: v.reference,
    propertyName: p.name,
    checkin: formatDate(v.checkin),
    checkout: formatDate(v.checkout),
    checkinTime: formatTime(v.arrivalTime ?? p.checkinTime),
    checkoutTime: formatTime(v.departureTime ?? p.checkoutTime),
    nights: v.nights,
    rooms: v.rooms
      .filter((r) => r.status !== 'Cancelled')
      .map(roomLine)
      .join('\n'),
    total: money(v.total, v.currency),
    paid: money(v.paid, v.currency),
    balance: money(Math.max(0, v.balance), v.currency),
    linkLine: link ? `View your booking online: ${link}\n\n` : '',
    propertyAddress: [p.address, p.city].filter(Boolean).join(', '),
    propertyContact: [p.phone && `Tel: ${p.phone}`, p.email].filter(Boolean).join(' · '),
  };
}

/** The voucher email's subject and body, from the tenant's template (or the starter one). */
export async function renderVoucher(tx: Tx, v: Voucher, link: string | null) {
  const [tpl] = await tx
    .select()
    .from(templates)
    .where(and(eq(templates.key, 'booking_voucher'), eq(templates.language, 'en')));
  const t = tpl ?? defaultTemplates(v.tenantId).find((d) => d.key === 'booking_voucher')!;
  const vars = voucherVars(v, link);
  return { subject: renderTemplate(t.subject, vars), body: renderTemplate(t.body, vars) };
}

/** A click-to-chat link carrying a short confirmation — WhatsApp is how guests here are reached. */
export function whatsappUrl(v: Voucher, link: string | null): string {
  const text =
    `Hello ${v.guest.name}, your booking ${v.reference} at ${v.property.name} is confirmed: ` +
    `${formatDate(v.checkin)} to ${formatDate(v.checkout)} (${v.nights} night${v.nights === 1 ? '' : 's'}).` +
    (link ? ` Your booking: ${link}` : '');
  const to = v.guest.mobileE164?.replace(/\D/g, '') ?? '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** The live guest-page link of a reservation, if there is one. */
export async function activeLink(tx: Tx, bookingIds: string[]) {
  const [row] = await tx
    .select()
    .from(voucherTokens)
    .where(
      and(
        inArray(voucherTokens.bookingId, bookingIds),
        isNull(voucherTokens.revokedAt),
        gt(voucherTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(voucherTokens.createdAt))
    .limit(1);
  return row ?? null;
}

/** Queue the voucher to each address: one message per recipient, never one to many. */
export async function queueVoucher(
  tx: Tx,
  v: Voucher,
  emails: string[],
  link: string | null,
  pdf?: Buffer,
): Promise<number> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return 0;
  const { subject, body } = await renderVoucher(tx, v, link);
  await tx.insert(messages).values(
    unique.map((to) => ({
      tenantId: v.tenantId,
      bookingId: v.bookingIds[0]!,
      channel: 'email' as const,
      toAddress: to,
      templateKey: 'booking_voucher',
      language: 'en',
      subject,
      body,
      attachments: pdf ? [{ filename: `reservation-${v.reference}.pdf`, content: pdf.toString('base64') }] : null,
      status: 'queued' as const,
    })),
  );
  return unique.length;
}
