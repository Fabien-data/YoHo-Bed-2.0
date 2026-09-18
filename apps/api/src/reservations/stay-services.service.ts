import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  bookingInclusions,
  bookingTransfers,
  bookings,
  businessDates,
  chargeParticulars,
  folioCharges,
  properties,
  transportModes,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { localToday } from '../common/local-date';
import { routedWindow } from '../folio/windows';
import type { Actor } from './reservation.service';
import type {
  CreateInclusionDto,
  CreateTransferDto,
  TransportModeDto,
  UpdateTransferDto,
  UpdateTransportModeDto,
} from './dto';

const money = (n: number) => n.toFixed(2);
const DIRECTION_LABEL = { pickup: 'Pick-up', dropoff: 'Drop-off' } as const;

/**
 * What a stay includes besides the room (Development Phase 02, Sprint 5): inclusions posted by
 * night audit, and pick-ups and drop-offs charged when done. Every plan: a guest house sells
 * breakfast and airport runs too.
 */
@Injectable()
export class StayServicesService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Inclusions --------------------------------------------------------------------------

  inclusions(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      return tx
        .select()
        .from(bookingInclusions)
        .where(eq(bookingInclusions.bookingId, bookingId))
        .orderBy(asc(bookingInclusions.createdAt));
    });
  }

  addInclusion(actor: Actor, bookingId: string, dto: CreateInclusionDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      if (b.status !== 'Pending' && b.status !== 'Approved' && b.status !== 'CheckedIn') {
        throw new BadRequestException(`A ${b.status} stay cannot take new inclusions`);
      }
      if (dto.particularId) {
        const [p] = await tx
          .select({ id: chargeParticulars.id })
          .from(chargeParticulars)
          .where(eq(chargeParticulars.id, dto.particularId));
        if (!p) throw new NotFoundException('Charge particular not found');
      }
      const [row] = await tx
        .insert(bookingInclusions)
        .values({
          tenantId: actor.tenantId,
          bookingId,
          particularId: dto.particularId ?? null,
          name: dto.name,
          rhythm: dto.rhythm,
          unitPrice: money(dto.unitPrice),
          discountPct: dto.discountPct.toFixed(3),
          taxRatePct: dto.taxRatePct.toFixed(3),
          includedInRate: dto.includedInRate,
          itemize: dto.itemize,
          createdByUserId: actor.userId,
        })
        .returning();
      return row;
    });
  }

  /** Stop an inclusion. What was already posted stays on the bill (void it there if it was wrong). */
  removeInclusion(tenantId: string, inclusionId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const gone = await tx
        .delete(bookingInclusions)
        .where(eq(bookingInclusions.id, inclusionId))
        .returning({ id: bookingInclusions.id });
      if (gone.length === 0) throw new NotFoundException('Inclusion not found');
      return { id: inclusionId, deleted: true };
    });
  }

  // --- Transfers ----------------------------------------------------------------------------

  transfers(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      return tx
        .select({
          transfer: bookingTransfers,
          modeName: transportModes.name,
        })
        .from(bookingTransfers)
        .leftJoin(transportModes, eq(transportModes.id, bookingTransfers.transportModeId))
        .where(eq(bookingTransfers.bookingId, bookingId))
        .orderBy(asc(bookingTransfers.scheduledAt), asc(bookingTransfers.createdAt))
        .then((rows) => rows.map((r) => ({ ...r.transfer, modeName: r.modeName })));
    });
  }

  addTransfer(actor: Actor, bookingId: string, dto: CreateTransferDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      if (dto.transportModeId) await this.mode(tx, dto.transportModeId);
      const [row] = await tx
        .insert(bookingTransfers)
        .values({
          tenantId: actor.tenantId,
          bookingId,
          direction: dto.direction,
          transportModeId: dto.transportModeId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          fromPlace: dto.fromPlace ?? null,
          toPlace: dto.toPlace ?? null,
          flightNo: dto.flightNo ?? null,
          pax: dto.pax,
          vehicle: dto.vehicle ?? null,
          driver: dto.driver ?? null,
          amount: money(dto.amount),
          notes: dto.notes ?? null,
          createdByUserId: actor.userId,
        })
        .returning();
      return row;
    });
  }

  /**
   * Change a transfer. Marking it done posts its charge (to the window that takes extras);
   * cancelling a done one voids that charge. A done transfer's price is fixed: it is on a bill.
   */
  updateTransfer(actor: Actor, transferId: string, dto: UpdateTransferDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [t] = await tx
        .select()
        .from(bookingTransfers)
        .where(eq(bookingTransfers.id, transferId))
        .for('update');
      if (!t) throw new NotFoundException('Transfer not found');
      if (t.status === 'done' && dto.amount !== undefined && money(dto.amount) !== t.amount) {
        throw new ConflictException(
          'A completed transfer is on the bill; cancel it to change the price',
        );
      }
      if (dto.transportModeId) await this.mode(tx, dto.transportModeId);

      let chargeId = t.chargeId;
      const nextStatus = dto.status ?? t.status;
      const amount = dto.amount ?? Number(t.amount);
      if (nextStatus === 'done' && t.status !== 'done' && amount > 0) {
        const [b] = await tx.select().from(bookings).where(eq(bookings.id, t.bookingId));
        const window = await routedWindow(
          tx,
          actor.tenantId,
          { id: b!.id, propertyId: b!.propertyId, currency: b!.currency },
          'manual',
        );
        const modeName =
          (dto.transportModeId ?? t.transportModeId)
            ? (await this.mode(tx, (dto.transportModeId ?? t.transportModeId)!)).name
            : null;
        const direction = (dto.direction ?? t.direction) as keyof typeof DIRECTION_LABEL;
        const [charge] = await tx
          .insert(folioCharges)
          .values({
            tenantId: actor.tenantId,
            folioId: window.id,
            source: 'manual',
            description: `${DIRECTION_LABEL[direction]}${modeName ? ` — ${modeName}` : ''}`,
            postedFor: await this.businessDate(tx, b!.propertyId),
            quantity: '1',
            unitPrice: money(amount),
            net: money(amount),
            tax: '0.00',
            total: money(amount),
            postedByUserId: actor.userId,
          })
          .returning({ id: folioCharges.id });
        chargeId = charge!.id;
      }
      if (nextStatus === 'cancelled' && t.chargeId) {
        await tx
          .update(folioCharges)
          .set({ voidedAt: new Date(), voidReason: 'Transfer cancelled', updatedAt: new Date() })
          .where(and(eq(folioCharges.id, t.chargeId), isNull(folioCharges.voidedAt)));
        chargeId = null;
      }

      const [row] = await tx
        .update(bookingTransfers)
        .set({
          ...(dto.direction !== undefined && { direction: dto.direction }),
          ...(dto.transportModeId !== undefined && { transportModeId: dto.transportModeId }),
          ...(dto.scheduledAt !== undefined && { scheduledAt: new Date(dto.scheduledAt) }),
          ...(dto.fromPlace !== undefined && { fromPlace: dto.fromPlace }),
          ...(dto.toPlace !== undefined && { toPlace: dto.toPlace }),
          ...(dto.flightNo !== undefined && { flightNo: dto.flightNo }),
          ...(dto.pax !== undefined && { pax: dto.pax }),
          ...(dto.vehicle !== undefined && { vehicle: dto.vehicle }),
          ...(dto.driver !== undefined && { driver: dto.driver }),
          ...(dto.amount !== undefined && { amount: money(dto.amount) }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          status: nextStatus,
          chargeId,
          updatedAt: new Date(),
        })
        .where(eq(bookingTransfers.id, transferId))
        .returning();
      return row;
    });
  }

  // --- Transport modes ------------------------------------------------------------------------

  modes(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(transportModes).orderBy(asc(transportModes.sort), asc(transportModes.name)),
    );
  }

  createMode(tenantId: string, dto: TransportModeDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(transportModes)
        .values({
          tenantId,
          code: dto.code,
          name: dto.name,
          defaultPrice: money(dto.defaultPrice),
          sort: dto.sort ?? 0,
          active: dto.active ?? true,
        })
        .onConflictDoNothing({ target: [transportModes.tenantId, transportModes.code] })
        .returning();
      if (!row) throw new ConflictException(`A transport mode "${dto.code}" already exists`);
      return row;
    });
  }

  updateMode(tenantId: string, id: string, dto: UpdateTransportModeDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .update(transportModes)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.defaultPrice !== undefined && { defaultPrice: money(dto.defaultPrice) }),
          ...(dto.sort !== undefined && { sort: dto.sort }),
          ...(dto.active !== undefined && { active: dto.active }),
          updatedAt: new Date(),
        })
        .where(eq(transportModes.id, id))
        .returning();
      if (!row) throw new NotFoundException('Transport mode not found');
      return row;
    });
  }

  // --- helpers -----------------------------------------------------------------------------

  private async booking(tx: Tx, id: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id));
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async mode(tx: Tx, id: string) {
    const [m] = await tx.select().from(transportModes).where(eq(transportModes.id, id));
    if (!m) throw new NotFoundException('Transport mode not found');
    return m;
  }

  /** The business date a charge belongs to: night audit's date, else the hotel's calendar today. */
  private async businessDate(tx: Tx, propertyId: string) {
    const [bd] = await tx
      .select({ currentDate: businessDates.currentDate })
      .from(businessDates)
      .where(eq(businessDates.propertyId, propertyId));
    if (bd) return bd.currentDate;
    const [p] = await tx
      .select({ timezone: properties.timezone })
      .from(properties)
      .where(eq(properties.id, propertyId));
    return localToday(p?.timezone);
  }
}
