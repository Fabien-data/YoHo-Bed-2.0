import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  bookingApprovals,
  bookingGroups,
  bookingRooms,
  bookings,
  maintenanceBlocks,
  InsufficientAvailabilityError,
  releaseBookingInventory,
  reserveBookingInventory,
  roomUnits,
  type Tx,
} from '@yohobed/db';
import { holdKindFor, RESERVATION_KIND_META, type ReservationKind } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { BookingService } from '../bookings/booking.service';
import type { Actor } from './reservation.service';
import type { ConfirmDto, GroupCancelDto, HoldDto, ReleaseHoldDto } from './dto';

type BookingRow = typeof bookings.$inferSelect;

const HOLD_KINDS: ReservationKind[] = ['hold_confirm', 'hold_unconfirm'];

/**
 * The reservation-type actions on an existing booking (Development Phase 02): confirm it, put it
 * on hold, release a hold — and the same for every room of a multi-room reservation at once.
 *
 * Each action locks the booking first and moves inventory only across the line the kind draws:
 * a booking that starts holding rooms reserves them (and can be refused with 409), one that
 * stops gives them back.
 */
@Injectable()
export class ReservationLifecycleService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly bookingsService: BookingService,
  ) {}

  confirm(actor: Actor, bookingId: string, dto: ConfirmDto) {
    return this.dbs.withTenant(actor.tenantId, (tx) =>
      this.confirmWithin(tx, actor, bookingId, dto.reason),
    );
  }

  hold(actor: Actor, bookingId: string, dto: HoldDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const b = await this.lock(tx, bookingId);
      if (b.status !== 'Pending' && b.status !== 'Approved') {
        throw new BadRequestException(`Cannot put a ${b.status} booking on hold`);
      }
      const target = holdKindFor(b.reservationKind as ReservationKind, dto.kind);
      if (!target) {
        throw new BadRequestException('A confirmed booking cannot become an unconfirmed hold');
      }
      const until = dto.until === null ? null : new Date(dto.until);
      if (until && until.getTime() <= Date.now()) {
        throw new BadRequestException('The hold must release in the future');
      }
      if (!b.inventoryHeld) await this.takeRooms(tx, b);

      const [updated] = await tx
        .update(bookings)
        .set({
          reservationKind: target,
          status: RESERVATION_KIND_META[target].initialStatus,
          holdUntil: until,
          holdRemindedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, b.id))
        .returning();
      if (!b.inventoryHeld) await this.assignPreferred(tx, b);
      await tx.insert(bookingApprovals).values({
        tenantId: actor.tenantId,
        bookingId: b.id,
        action: 'held',
        reason: until ? `until ${until.toISOString()}` : 'no release time',
        actorUserId: actor.userId,
      });
      return updated;
    });
  }

  releaseHold(actor: Actor, bookingId: string, dto: ReleaseHoldDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const b = await this.lock(tx, bookingId);
      if (!HOLD_KINDS.includes(b.reservationKind as ReservationKind)) {
        throw new BadRequestException('Only a hold can be released');
      }
      if (b.status !== 'Pending' && b.status !== 'Approved') {
        throw new BadRequestException(`Cannot release a ${b.status} booking`);
      }
      const [updated] = await tx
        .update(bookings)
        .set({ status: 'Cancelled', updatedAt: new Date() })
        .where(eq(bookings.id, b.id))
        .returning();
      await releaseBookingInventory(tx, b, { origin: 'hold_release' });
      await tx.insert(bookingApprovals).values({
        tenantId: actor.tenantId,
        bookingId: b.id,
        action: 'released',
        reason: dto.reason ?? 'released by staff',
        actorUserId: actor.userId,
      });
      return updated;
    });
  }

  /** Confirm every live room of a reservation; all or nothing. */
  confirmGroup(actor: Actor, groupId: string, dto: ConfirmDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const members = await this.groupMembers(tx, groupId);
      const todo = members.filter(
        (m) =>
          (m.status === 'Pending' || m.status === 'Approved') && m.reservationKind !== 'confirm',
      );
      if (todo.length === 0) throw new BadRequestException('Every room is already confirmed');
      const confirmed = [];
      for (const m of todo) confirmed.push(await this.confirmWithin(tx, actor, m.id, dto.reason));
      return { groupId, confirmed: confirmed.map((b) => b.reference) };
    });
  }

  /** Cancel every room of a reservation that has not arrived; all or nothing. */
  cancelGroup(actor: Actor, groupId: string, dto: GroupCancelDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const members = await this.groupMembers(tx, groupId);
      const todo = members.filter((m) => m.status === 'Pending' || m.status === 'Approved');
      if (todo.length === 0)
        throw new BadRequestException('No room of this reservation can be cancelled');
      const cancelled = [];
      for (const m of todo) {
        const b = await this.bookingsService.transitionWithin(
          tx,
          actor.tenantId,
          m.id,
          'cancel',
          dto.reason,
          { actorUserId: actor.userId },
        );
        cancelled.push(b!.reference);
      }
      return { groupId, cancelled };
    });
  }

  // --- internals ---------------------------------------------------------------

  private async confirmWithin(tx: Tx, actor: Actor, bookingId: string, reason?: string) {
    const b = await this.lock(tx, bookingId);
    if (b.status !== 'Pending' && b.status !== 'Approved') {
      throw new BadRequestException(`Cannot confirm a ${b.status} booking`);
    }
    if (b.reservationKind === 'confirm') {
      throw new BadRequestException(`${b.reference} is already confirmed`);
    }
    if (!b.inventoryHeld) await this.takeRooms(tx, b);

    const [updated] = await tx
      .update(bookings)
      .set({
        reservationKind: 'confirm',
        status: 'Approved',
        holdUntil: null,
        holdRemindedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, b.id))
      .returning();
    if (!b.inventoryHeld) await this.assignPreferred(tx, b);
    await tx.insert(bookingApprovals).values({
      tenantId: actor.tenantId,
      bookingId: b.id,
      action: 'confirmed',
      reason: reason ?? null,
      actorUserId: actor.userId,
    });
    return updated!;
  }

  private async lock(tx: Tx, bookingId: string): Promise<BookingRow> {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async groupMembers(tx: Tx, groupId: string) {
    const [group] = await tx
      .select({ id: bookingGroups.id })
      .from(bookingGroups)
      .where(eq(bookingGroups.id, groupId));
    if (!group) throw new NotFoundException('Reservation not found');
    return tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        reservationKind: bookings.reservationKind,
      })
      .from(bookings)
      .where(eq(bookings.groupId, groupId))
      .orderBy(asc(bookings.reference));
  }

  /** Take rooms for a booking that held none — the moment an inquiry becomes real. */
  private async takeRooms(tx: Tx, b: BookingRow) {
    try {
      await reserveBookingInventory(tx, b, 'confirm');
    } catch (e) {
      if (e instanceof InsufficientAvailabilityError) {
        throw new ConflictException({
          reason: 'insufficient_availability',
          message: `No room of this type is free on ${e.date} any more (${b.reference}).`,
          bookingId: b.id,
          date: e.date,
        });
      }
      throw e;
    }
  }

  /**
   * Put the guest in the room they asked for, if it is still free. A preference that has since
   * gone is not an error: the booking is confirmed and the room is assigned at the desk.
   */
  private async assignPreferred(tx: Tx, b: BookingRow) {
    const legs = await tx
      .select({
        id: bookingRooms.id,
        preferred: bookingRooms.preferredRoomUnitId,
        status: roomUnits.status,
      })
      .from(bookingRooms)
      .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.preferredRoomUnitId))
      .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
    for (const leg of legs) {
      if (!leg.preferred || leg.status !== 'active') continue;
      const [blocked] = await tx
        .select({ id: maintenanceBlocks.id })
        .from(maintenanceBlocks)
        .where(
          and(
            eq(maintenanceBlocks.roomUnitId, leg.preferred),
            isNull(maintenanceBlocks.releasedAt),
            sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)')
                && daterange(${b.checkin}::date, ${b.checkout}::date, '[)')`,
          ),
        )
        .limit(1);
      if (blocked) continue;
      try {
        await tx.transaction(async (sp) => {
          await sp
            .update(bookingRooms)
            .set({ roomUnitId: leg.preferred, preferredRoomUnitId: null, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
        });
      } catch (e) {
        if ((e as { code?: string })?.code !== '23P01') throw e;
      }
    }
  }
}
