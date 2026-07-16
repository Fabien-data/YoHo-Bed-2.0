import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { cmRoomMappings, otaReservations, occupancies, ratePlans, rooms } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { BookingService } from '../bookings/booking.service';
import { MailerService } from '../email/mailer.service';
import type { CmReservationDto, SetMappingDto, SimulateDto } from './dto';

type OtaReservationRow = typeof otaReservations.$inferSelect;

/**
 * OTA reservation inbox (Compartment F) — the inbound mirror of the Phase 6 outbox.
 *
 * Every webhook push is recorded in `ota_reservations` BEFORE the import is attempted, so an
 * incoming reservation can fail (no availability, no rates) but never vanish. Imports go through
 * BookingService.create — the same audited path as a walk-in (atomic inventory, correct
 * occupancy key, safe reference, tax decomposition) — with source 'OTA' and auto-approval,
 * because the guest has already paid the OTA.
 */
@Injectable()
export class OtaService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly bookings: BookingService,
    private readonly mailer: MailerService,
  ) {}

  /** Webhook entry. Idempotent on (channel, externalRef). */
  async ingest(p: CmReservationDto) {
    // cm_room_mappings has no RLS: the tenant is resolved FROM the room code.
    const [mapping] = await this.dbs.db
      .select()
      .from(cmRoomMappings)
      .where(eq(cmRoomMappings.code, p.roomCode));
    if (!mapping) {
      // Non-2xx so the channel manager retries/alerts instead of assuming delivery.
      throw new UnprocessableEntityException({
        reason: 'unmapped_room_code',
        roomCode: p.roomCode,
      });
    }

    if (p.action === 'cancel') return this.cancelByRef(mapping.tenantId, p);

    const existing = await this.findByRef(mapping.tenantId, p.channel, p.externalRef);
    if (existing) return { id: existing.id, status: existing.status, deduped: true };

    // Record the reservation first — a failed import keeps this row + error for the inbox.
    const [row] = await this.dbs.withTenant(mapping.tenantId, (tx) =>
      tx
        .insert(otaReservations)
        .values({
          tenantId: mapping.tenantId,
          propertyId: mapping.propertyId,
          roomId: mapping.roomId,
          channel: p.channel,
          externalRef: p.externalRef,
          guestName: p.guest!.name,
          guestEmail: p.guest!.email ?? null,
          guestPhone: p.guest!.phone ?? null,
          checkin: p.checkin,
          checkout: p.checkout,
          rooms: p.rooms,
          otaAmount: p.amount != null ? p.amount.toFixed(2) : null,
          payload: p,
        })
        .returning(),
    );
    return this.import(row!);
  }

  /** The owner's inbox: every reservation the channel manager pushed, newest first. */
  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(otaReservations).orderBy(desc(otaReservations.receivedAt)).limit(100),
    );
  }

  /** Re-attempt a failed import (e.g. after opening availability or setting prices). */
  async retry(tenantId: string, id: string) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(otaReservations).where(eq(otaReservations.id, id)),
    );
    if (!row) throw new NotFoundException('Reservation not found');
    if (row.status !== 'failed') {
      throw new BadRequestException(
        `Only failed reservations can be retried (status: ${row.status})`,
      );
    }
    return this.import(row);
  }

  // --- Room-code mappings -----------------------------------------------------

  listMappings(tenantId: string) {
    // No RLS on this table — filter explicitly.
    return this.dbs.db.select().from(cmRoomMappings).where(eq(cmRoomMappings.tenantId, tenantId));
  }

  async setMapping(tenantId: string, dto: SetMappingDto) {
    // The room lookup runs under RLS, so a foreign roomId comes back empty.
    const [room] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, dto.roomId)),
    );
    if (!room) throw new NotFoundException('Room not found');
    try {
      const [row] = await this.dbs.db
        .insert(cmRoomMappings)
        .values({ tenantId, propertyId: room.propertyId, roomId: room.id, code: dto.code })
        .onConflictDoUpdate({
          target: cmRoomMappings.roomId,
          set: { code: dto.code, updatedAt: new Date() },
        })
        .returning();
      return row;
    } catch {
      throw new ConflictException(`Code '${dto.code}' is already mapped to another room`);
    }
  }

  /** Dev/demo helper: fabricate an incoming OTA reservation for one of the tenant's rooms. */
  async simulate(tenantId: string, dto: SimulateDto) {
    const where = dto.roomId
      ? and(eq(cmRoomMappings.tenantId, tenantId), eq(cmRoomMappings.roomId, dto.roomId))
      : eq(cmRoomMappings.tenantId, tenantId);
    const [mapping] = await this.dbs.db.select().from(cmRoomMappings).where(where).limit(1);
    if (!mapping) throw new BadRequestException('Map a room to a CM code first');
    return this.ingest({
      channel: dto.channel,
      externalRef: `SIM-${Date.now()}`,
      action: 'book',
      roomCode: mapping.code,
      guest: { name: dto.guestName, email: 'sim.guest@example.com' },
      checkin: dto.checkin,
      checkout: dto.checkout,
      rooms: 1,
    });
  }

  // --- Internals ---------------------------------------------------------------

  private async findByRef(tenantId: string, channel: string, externalRef: string) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(otaReservations)
        .where(
          and(eq(otaReservations.channel, channel), eq(otaReservations.externalRef, externalRef)),
        ),
    );
    return row;
  }

  /** Import one recorded reservation as a booking. Marks the row imported/failed accordingly. */
  private async import(row: OtaReservationRow) {
    try {
      const roomId = row.roomId;
      if (!roomId) throw new BadRequestException('Reservation has no mapped room');
      const booking = await this.dbs.withTenant(row.tenantId, async (tx) => {
        // The OTA sends a room code, not our pricing key — book on the room's default occupancy.
        const [occ] = await tx
          .select({ id: occupancies.id })
          .from(occupancies)
          .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
          .where(eq(ratePlans.roomId, roomId))
          .orderBy(occupancies.createdAt)
          .limit(1);
        if (!occ)
          throw new BadRequestException('No rate plan/occupancy configured for the mapped room');
        const b = await this.bookings.create(
          tx,
          row.tenantId,
          {
            roomId,
            occupancyId: occ.id,
            customerName: row.guestName,
            customerEmail: row.guestEmail ?? undefined,
            customerPhone: row.guestPhone ?? undefined,
            checkin: row.checkin,
            checkout: row.checkout,
            rooms: row.rooms,
          },
          { source: 'OTA', autoApprove: true, channelLabel: row.channel },
        );
        await tx
          .update(otaReservations)
          .set({ status: 'imported', bookingId: b!.id, error: null, processedAt: new Date() })
          .where(eq(otaReservations.id, row.id));
        return b!;
      });
      this.mailer.deliverQueuedSafe(row.tenantId); // after commit: send the queued confirmation
      return {
        id: row.id,
        status: 'imported' as const,
        bookingId: booking.id,
        reference: booking.reference,
      };
    } catch (e) {
      const error =
        e instanceof HttpException
          ? JSON.stringify(e.getResponse())
          : e instanceof Error
            ? e.message
            : String(e);
      await this.dbs.withTenant(row.tenantId, (tx) =>
        tx
          .update(otaReservations)
          .set({ status: 'failed', error, processedAt: new Date() })
          .where(eq(otaReservations.id, row.id)),
      );
      return { id: row.id, status: 'failed' as const, error };
    }
  }

  private async cancelByRef(tenantId: string, p: CmReservationDto) {
    const row = await this.findByRef(tenantId, p.channel, p.externalRef);
    if (!row) return { status: 'ignored' as const, reason: 'unknown reservation' };
    if (row.status === 'cancelled') return { id: row.id, status: row.status, deduped: true };
    if (row.status === 'imported' && row.bookingId) {
      await this.bookings.cancel(tenantId, row.bookingId); // releases inventory
    }
    await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .update(otaReservations)
        .set({ status: 'cancelled', processedAt: new Date() })
        .where(eq(otaReservations.id, row.id)),
    );
    return { id: row.id, status: 'cancelled' as const };
  }
}
