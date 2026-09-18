import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  ledgerAccountRates,
  ledgerAccounts,
  marketSegments,
  ratePlans,
  rooms,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { CreateContractRateDto, UpdateContractRateDto, UpdateRatePlanDto } from './dto';

/**
 * A travel agent's or company's contract rates (Pro), and the reservation-facing settings of a
 * rate plan — who it is sold to and the market segment it starts with.
 *
 * Every id in a request is loaded under RLS before it is written, because a foreign key alone
 * would happily accept another tenant's room.
 */
@Injectable()
export class ContractRatesService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string, accountId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.account(tx, accountId);
      return tx
        .select({
          id: ledgerAccountRates.id,
          ledgerAccountId: ledgerAccountRates.ledgerAccountId,
          propertyId: ledgerAccountRates.propertyId,
          roomId: ledgerAccountRates.roomId,
          roomName: rooms.name,
          ratePlanId: ledgerAccountRates.ratePlanId,
          validFrom: ledgerAccountRates.validFrom,
          validTo: ledgerAccountRates.validTo,
          mode: ledgerAccountRates.mode,
          value: ledgerAccountRates.value,
          active: ledgerAccountRates.active,
          note: ledgerAccountRates.note,
        })
        .from(ledgerAccountRates)
        .innerJoin(rooms, eq(rooms.id, ledgerAccountRates.roomId))
        .where(eq(ledgerAccountRates.ledgerAccountId, accountId))
        .orderBy(asc(rooms.name), asc(ledgerAccountRates.validFrom));
    });
  }

  create(tenantId: string, accountId: string, dto: CreateContractRateDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.account(tx, accountId);
      await this.checkRoom(tx, dto.propertyId, dto.roomId, dto.ratePlanId ?? null);
      const [row] = await tx
        .insert(ledgerAccountRates)
        .values({
          tenantId,
          ledgerAccountId: accountId,
          propertyId: dto.propertyId,
          roomId: dto.roomId,
          ratePlanId: dto.ratePlanId ?? null,
          validFrom: dto.validFrom,
          validTo: dto.validTo,
          mode: dto.mode,
          value: dto.value.toFixed(2),
          active: dto.active ?? true,
          note: dto.note ?? null,
        })
        .returning();
      return row;
    });
  }

  update(tenantId: string, accountId: string, rateId: string, dto: UpdateContractRateDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(ledgerAccountRates)
        .where(
          and(eq(ledgerAccountRates.id, rateId), eq(ledgerAccountRates.ledgerAccountId, accountId)),
        );
      if (!current) throw new NotFoundException('Contract rate not found');
      if (dto.ratePlanId) {
        await this.checkRoom(tx, current.propertyId, current.roomId, dto.ratePlanId);
      }
      const validFrom = dto.validFrom ?? current.validFrom;
      const validTo = dto.validTo ?? current.validTo;
      if (validTo < validFrom) throw new BadRequestException('validTo is before validFrom');
      const mode = dto.mode ?? current.mode;
      const value = dto.value ?? Number(current.value);
      if (mode === 'discount_pct' && value > 100) {
        throw new BadRequestException('a discount is at most 100%');
      }
      const [row] = await tx
        .update(ledgerAccountRates)
        .set({
          ...(dto.ratePlanId !== undefined && { ratePlanId: dto.ratePlanId }),
          validFrom,
          validTo,
          mode,
          value: value.toFixed(2),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.note !== undefined && { note: dto.note }),
          updatedAt: new Date(),
        })
        .where(eq(ledgerAccountRates.id, rateId))
        .returning();
      return row;
    });
  }

  /** Who a rate plan is sold to, whether it is on sale, and its default market segment. */
  updateRatePlan(tenantId: string, ratePlanId: string, dto: UpdateRatePlanDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [plan] = await tx
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(eq(ratePlans.id, ratePlanId));
      if (!plan) throw new NotFoundException('Rate plan not found');
      if (dto.marketSegmentId) {
        const [seg] = await tx
          .select({ id: marketSegments.id })
          .from(marketSegments)
          .where(eq(marketSegments.id, dto.marketSegmentId));
        if (!seg) throw new NotFoundException('Market segment not found');
      }
      const [row] = await tx
        .update(ratePlans)
        .set({
          ...(dto.audience !== undefined && { audience: dto.audience }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.marketSegmentId !== undefined && { marketSegmentId: dto.marketSegmentId }),
          updatedAt: new Date(),
        })
        .where(eq(ratePlans.id, ratePlanId))
        .returning();
      return row;
    });
  }

  private async account(tx: Tx, accountId: string) {
    const [a] = await tx
      .select({ id: ledgerAccounts.id, type: ledgerAccounts.type })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    if (!a || (a.type !== 'travel_agent' && a.type !== 'company')) {
      throw new NotFoundException('Travel agent or company not found');
    }
    return a;
  }

  private async checkRoom(tx: Tx, propertyId: string, roomId: string, ratePlanId: string | null) {
    const [room] = await tx
      .select({ propertyId: rooms.propertyId })
      .from(rooms)
      .where(eq(rooms.id, roomId));
    if (!room || room.propertyId !== propertyId) {
      throw new NotFoundException('Room type not found in this property');
    }
    if (ratePlanId) {
      const [plan] = await tx
        .select({ roomId: ratePlans.roomId })
        .from(ratePlans)
        .where(eq(ratePlans.id, ratePlanId));
      if (!plan || plan.roomId !== roomId) {
        throw new NotFoundException('That meal plan is not on this room type');
      }
    }
  }
}
