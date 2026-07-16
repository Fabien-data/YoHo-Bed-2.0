import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { reviews, reviewInvites, notifications, properties, bookings } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { SubmitReviewDto } from './dto';

/**
 * Guest reviews (Compartment I). Submission is public: the check-out email carries a single-use
 * link whose unguessable 128-bit token both authorizes the guest and resolves the tenant —
 * `review_invites` has no RLS for exactly that reason (see cm_room_mappings for the pattern).
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly dbs: DatabaseService) {}

  /** What the public review form shows before submitting. */
  async inviteInfo(token: string) {
    const [invite] = await this.dbs.db
      .select()
      .from(reviewInvites)
      .where(eq(reviewInvites.token, token));
    if (!invite) throw new NotFoundException('Review link not found');
    return {
      guestName: invite.guestName,
      propertyName: invite.propertyName,
      checkin: invite.checkin,
      checkout: invite.checkout,
      used: invite.usedAt !== null,
    };
  }

  /** Public, single-use submission. */
  async submit(dto: SubmitReviewDto) {
    const [invite] = await this.dbs.db
      .select()
      .from(reviewInvites)
      .where(eq(reviewInvites.token, dto.token));
    if (!invite) throw new NotFoundException('Review link not found');
    if (invite.usedAt) throw new BadRequestException('This review has already been submitted');

    await this.dbs.withTenant(invite.tenantId, async (tx) => {
      await tx.insert(reviews).values({
        tenantId: invite.tenantId,
        propertyId: invite.propertyId,
        bookingId: invite.bookingId,
        rating: dto.rating,
        comment: dto.comment ?? null,
        guestName: invite.guestName,
      });
      await tx.insert(notifications).values({
        tenantId: invite.tenantId,
        type: 'review_received',
        title: `New ${dto.rating}★ review for ${invite.propertyName}`,
        body: dto.comment ? dto.comment.slice(0, 200) : `${invite.guestName} rated their stay ${dto.rating}/5.`,
        entity: 'booking',
        entityId: invite.bookingId,
      });
    });
    // Burn the invite (no RLS on this table; keyed by exact token).
    await this.dbs.db
      .update(reviewInvites)
      .set({ usedAt: new Date() })
      .where(eq(reviewInvites.token, dto.token));
    return { submitted: true, propertyName: invite.propertyName };
  }

  /** Owner view: all reviews with per-property averages. */
  async listForTenant(tenantId: string) {
    const rows = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: reviews.id,
          propertyId: reviews.propertyId,
          propertyName: properties.name,
          bookingReference: bookings.reference,
          rating: reviews.rating,
          comment: reviews.comment,
          guestName: reviews.guestName,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .innerJoin(properties, eq(properties.id, reviews.propertyId))
        .innerJoin(bookings, eq(bookings.id, reviews.bookingId))
        .orderBy(desc(reviews.createdAt))
        .limit(200),
    );
    const byProperty = new Map<string, { propertyId: string; propertyName: string; count: number; sum: number }>();
    for (const r of rows) {
      const s = byProperty.get(r.propertyId) ?? {
        propertyId: r.propertyId,
        propertyName: r.propertyName,
        count: 0,
        sum: 0,
      };
      s.count += 1;
      s.sum += r.rating;
      byProperty.set(r.propertyId, s);
    }
    const summary = [...byProperty.values()].map((s) => ({
      propertyId: s.propertyId,
      propertyName: s.propertyName,
      count: s.count,
      average: Math.round((s.sum / s.count) * 10) / 10,
    }));
    return { reviews: rows, summary };
  }
}
