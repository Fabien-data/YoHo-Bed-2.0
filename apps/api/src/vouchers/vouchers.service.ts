import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { bookings, voucherTokens } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { Env } from '../config/env';
import {
  activeLink,
  buildVoucher,
  queueVoucher,
  renderVoucher,
  whatsappUrl,
  type Voucher,
} from './voucher';

/** How long a guest page link lives after the guest leaves. */
const LINK_DAYS_AFTER_CHECKOUT = 30;

/**
 * Vouchers and the guest booking page (Development Phase 02, Sprint 6). The desk previews and
 * sends the voucher, and makes, shares or revokes the guest's link; the guest opens the page with
 * no login. Every plan.
 */
@Injectable()
export class VouchersService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private url(token: string) {
    return `${this.config.get('WEB_URL', { infer: true })}/voucher/${token}`;
  }

  private async voucher(tx: Parameters<typeof buildVoucher>[0], bookingId: string) {
    const v = await buildVoucher(tx, bookingId);
    if (!v) throw new NotFoundException('Booking not found');
    return v;
  }

  /** Who it would go to, what it says, and the WhatsApp link — before anything is sent. */
  preview(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const v = await this.voucher(tx, bookingId);
      const link = await activeLink(tx, v.bookingIds);
      const url = link ? this.url(link.token) : null;
      const { subject, body } = await renderVoucher(tx, v, url);
      return {
        reference: v.reference,
        subject,
        body,
        recipients: recipientsOf(v),
        whatsappUrl: whatsappUrl(v, url),
        link: link ? { url: url!, expiresAt: link.expiresAt } : null,
      };
    });
  }

  /** Queue the voucher, one email per address. Delivered after the transaction commits. */
  send(tenantId: string, bookingId: string, emails: string[]) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const v = await this.voucher(tx, bookingId);
      const link = await activeLink(tx, v.bookingIds);
      const queued = await queueVoucher(tx, v, emails, link ? this.url(link.token) : null);
      return { queued, recipients: [...new Set(emails.map((e) => e.trim().toLowerCase()))] };
    });
  }

  /**
   * The guest page link: the live one, or a new one. Making it turns "Access to guest portal" on
   * for the reservation — the desk asking for the link is the decision to share it.
   */
  link(tenantId: string, bookingId: string, userId: string | null) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const v = await this.voucher(tx, bookingId);
      let row = await activeLink(tx, v.bookingIds);
      const created = !row;
      if (!row) {
        const expires = new Date(`${v.checkout}T23:59:59.999Z`);
        expires.setUTCDate(expires.getUTCDate() + LINK_DAYS_AFTER_CHECKOUT);
        [row] = await tx
          .insert(voucherTokens)
          .values({
            tenantId,
            propertyId: v.propertyId,
            bookingId,
            expiresAt: expires,
            createdByUserId: userId,
          })
          .returning();
      }
      await setPortalAccess(tx, v.bookingIds, true);
      const url = this.url(row!.token);
      return {
        url,
        token: row!.token,
        expiresAt: row!.expiresAt,
        created,
        whatsappUrl: whatsappUrl(v, url),
      };
    });
  }

  /** Close the guest page: the link answers "not found" from now on. */
  revoke(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const v = await this.voucher(tx, bookingId);
      const gone = await tx
        .update(voucherTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            inArray(voucherTokens.bookingId, v.bookingIds),
            isNull(voucherTokens.revokedAt),
            gt(voucherTokens.expiresAt, new Date()),
          ),
        )
        .returning({ token: voucherTokens.token });
      await setPortalAccess(tx, v.bookingIds, false);
      return { revoked: gone.length };
    });
  }

  /**
   * The public guest page. The token is the key; an unknown, revoked or expired one is the same
   * 404, so a guess learns nothing. It shows the stay, not the guest's contact details.
   */
  async publicView(token: string) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new NotFoundException('Booking page not found');
    // voucher_tokens has no RLS (the guest has no tenant); read it by exact token only.
    const [row] = await this.dbs.db
      .select()
      .from(voucherTokens)
      .where(eq(voucherTokens.token, token));
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('Booking page not found');
    }
    const v = await this.dbs.withTenant(row.tenantId, (tx) => buildVoucher(tx, row.bookingId));
    if (!v || !v.options.guestPortalAccess) throw new NotFoundException('Booking page not found');
    await this.dbs.db
      .update(voucherTokens)
      .set({ viewCount: sql`${voucherTokens.viewCount} + 1`, lastViewedAt: new Date() })
      .where(eq(voucherTokens.token, token));
    return publicShape(v);
  }
}

/** Where the voucher goes by default: the guest, and the addresses the reservation asked for. */
export function recipientsOf(v: Voucher): string[] {
  return [
    ...new Set(
      [v.guest.email, ...v.options.voucherEmails]
        .filter((e): e is string => Boolean(e))
        .map((e) => e.trim().toLowerCase()),
    ),
  ];
}

async function setPortalAccess(
  tx: Parameters<typeof buildVoucher>[0],
  bookingIds: string[],
  on: boolean,
) {
  await tx
    .update(bookings)
    .set({
      options: sql`${bookings.options} || ${JSON.stringify({ guestPortalAccess: on })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(inArray(bookings.id, bookingIds));
}

/** What the guest page may show: the stay and the hotel — no email, phone or documents. */
function publicShape(v: Voucher) {
  const p = v.property;
  const place = [p.address, p.city, p.country].filter(Boolean).join(', ');
  const hotelPhone = p.phone?.replace(/[^\d+]/g, '') ?? '';
  return {
    reference: v.reference,
    status: v.status,
    // The first name is enough to greet the guest; the full name stays on the desk's screens.
    guestFirstName: v.guest.name.trim().split(/\s+/)[0] ?? '',
    property: {
      name: p.name,
      address: place || null,
      phone: p.phone,
      email: p.email,
      mapUrl: place
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name}, ${place}`)}`
        : null,
      whatsappUrl: hotelPhone
        ? `https://wa.me/${hotelPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello, about my booking ${v.reference}`)}`
        : null,
    },
    checkin: v.checkin,
    checkout: v.checkout,
    checkinTime: v.arrivalTime ?? p.checkinTime,
    checkoutTime: v.departureTime ?? p.checkoutTime,
    nights: v.nights,
    rooms: v.rooms
      .filter((r) => r.status !== 'Cancelled' && r.status !== 'Rejected')
      .map((r) => ({
        roomType: r.roomType,
        mealPlan: r.mealPlan,
        adults: r.adults,
        children: r.children,
      })),
    currency: v.currency,
    total: v.total.toFixed(2),
    paid: v.paid.toFixed(2),
    balance: Math.max(0, v.balance).toFixed(2),
  };
}
