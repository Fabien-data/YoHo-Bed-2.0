import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  bookings,
  marketSegments,
  occupancies,
  properties,
  rateCodes,
  ratePlans,
  rateTypes,
  rooms,
  type Tx,
} from '@yohobed/db';
import type { MealPlan } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import type {
  CreateOccupancyRowDto,
  CreateRatePlanDto,
  CreateRateTypeDto,
  UpdateOccupancyRowDto,
  UpdateRateTypeDto,
} from './rate-types.dto';

const money = (n: number) => n.toFixed(2);

/**
 * Yanolja's Rate Type and Rate Plan (Configuration, owner brief 2026-09-26).
 *
 * A rate type is the hotel's named pricing structure — the meal plan its price includes and any
 * bundled add-ons. A rate plan sells one room type under one rate type, in one or more guest
 * configurations (occupancies), each priced on the Rates & inventory calendar.
 */
@Injectable()
export class RateTypesService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Rate types ----------------------------------------------------------------------

  listRateTypes(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: rateTypes.id,
          propertyId: rateTypes.propertyId,
          name: rateTypes.name,
          shortCode: rateTypes.shortCode,
          mealPlan: rateTypes.mealPlan,
          addOns: rateTypes.addOns,
          description: rateTypes.description,
          sortOrder: rateTypes.sortOrder,
          active: rateTypes.active,
          // Correlations spelled out in full (a single-table select renders a bare "id").
          ratePlans: sql<number>`(select count(*) from rate_plans p where p.rate_type_id = rate_types.id)::int`,
          booked: sql<boolean>`exists (
            select 1 from bookings b
              join occupancies o on o.id = b.occupancy_id
              join rate_plans p on p.id = o.rate_plan_id
             where p.rate_type_id = rate_types.id)`,
        })
        .from(rateTypes)
        .where(eq(rateTypes.propertyId, propertyId))
        .orderBy(asc(rateTypes.sortOrder), asc(rateTypes.name)),
    );
  }

  createRateType(tenantId: string, propertyId: string, dto: CreateRateTypeDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.assertProperty(tx, propertyId);
      const [last] = await tx
        .select({ max: sql<number>`coalesce(max(${rateTypes.sortOrder}), 0)::int` })
        .from(rateTypes)
        .where(eq(rateTypes.propertyId, propertyId));
      try {
        const [row] = await tx
          .insert(rateTypes)
          .values({
            tenantId,
            propertyId,
            name: dto.name,
            shortCode: dto.shortCode.toUpperCase(),
            mealPlan: dto.mealPlan,
            addOns: dto.addOns.map((a) => ({ ...a, amount: money(a.amount) })),
            description: dto.description || null,
            active: dto.active,
            sortOrder: (last?.max ?? 0) + 10,
          })
          .returning();
        return row;
      } catch (e) {
        rethrowCode(e, dto.shortCode);
      }
    });
  }

  updateRateType(tenantId: string, id: string, dto: UpdateRateTypeDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [current] = await tx.select().from(rateTypes).where(eq(rateTypes.id, id)).for('update');
      if (!current) throw new NotFoundException('Rate type not found');
      if (dto.mealPlan !== undefined && dto.mealPlan !== current.mealPlan) {
        // What a sold stay included must not change after the fact.
        if (await this.rateTypeBooked(tx, id))
          throw new ConflictException({
            reason: 'rate_type_booked',
            message: `${current.name} has been booked, so its meal plan cannot change. Make a new rate type for the new plan instead.`,
          });
      }
      try {
        const [row] = await tx
          .update(rateTypes)
          .set({
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.shortCode !== undefined && { shortCode: dto.shortCode.toUpperCase() }),
            ...(dto.mealPlan !== undefined && { mealPlan: dto.mealPlan }),
            ...(dto.addOns !== undefined && {
              addOns: dto.addOns.map((a) => ({ ...a, amount: money(a.amount) })),
            }),
            ...(dto.description !== undefined && { description: dto.description || null }),
            ...(dto.active !== undefined && { active: dto.active }),
            updatedAt: new Date(),
          })
          .where(eq(rateTypes.id, id))
          .returning();
        // The plans selling it follow its meal plan — which pricing and the channels read.
        if (dto.mealPlan !== undefined && dto.mealPlan !== current.mealPlan) {
          const code = await this.rateCodeId(tx, dto.mealPlan);
          await tx
            .update(ratePlans)
            .set({ rateCodeId: code, updatedAt: new Date() })
            .where(eq(ratePlans.rateTypeId, id));
        }
        return row;
      } catch (e) {
        rethrowCode(e, dto.shortCode);
      }
    });
  }

  /** Delete a rate type no plan sells; one in use is switched off instead. */
  deleteRateType(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(rateTypes).where(eq(rateTypes.id, id)).for('update');
      if (!row) throw new NotFoundException('Rate type not found');
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ratePlans)
        .where(eq(ratePlans.rateTypeId, id));
      if ((used?.n ?? 0) > 0)
        throw new ConflictException({
          reason: 'rate_type_in_use',
          message: `${row.name} is sold by ${used!.n} rate plan${used!.n === 1 ? '' : 's'}. Switch it off to stop selling it, or remove those plans first.`,
        });
      await tx.delete(rateTypes).where(eq(rateTypes.id, id));
      return { deleted: true, id };
    });
  }

  reorderRateTypes(tenantId: string, propertyId: string, ids: string[]) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const mine = await tx
        .select({ id: rateTypes.id })
        .from(rateTypes)
        .where(and(eq(rateTypes.propertyId, propertyId), inArray(rateTypes.id, ids)));
      if (mine.length !== ids.length)
        throw new BadRequestException('Every rate type in the order must belong to this property');
      for (const [i, id] of ids.entries())
        await tx
          .update(rateTypes)
          .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
          .where(eq(rateTypes.id, id));
      return { ordered: ids.length };
    });
  }

  // --- Rate plans ----------------------------------------------------------------------

  /** Every rate plan of the property: room type × rate type, with its guest configurations. */
  listRatePlans(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const plans = await tx
        .select({
          id: ratePlans.id,
          roomId: ratePlans.roomId,
          roomName: rooms.name,
          roomActive: rooms.active,
          rateTypeId: ratePlans.rateTypeId,
          rateTypeName: rateTypes.name,
          rateTypeCode: rateTypes.shortCode,
          rateTypeActive: rateTypes.active,
          mealPlan: rateCodes.code,
          mealPlanName: rateCodes.name,
          audience: ratePlans.audience,
          status: ratePlans.status,
          marketSegmentId: ratePlans.marketSegmentId,
          marketSegmentName: marketSegments.name,
        })
        .from(ratePlans)
        .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
        .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
        .leftJoin(rateTypes, eq(rateTypes.id, ratePlans.rateTypeId))
        .leftJoin(marketSegments, eq(marketSegments.id, ratePlans.marketSegmentId))
        .where(eq(ratePlans.propertyId, propertyId))
        .orderBy(
          asc(rooms.sortOrder),
          asc(rooms.name),
          asc(sql`coalesce(${rateTypes.sortOrder}, 0)`),
          asc(rateCodes.sortOrder),
        );
      const occ = plans.length
        ? await tx
            .select({
              id: occupancies.id,
              ratePlanId: occupancies.ratePlanId,
              label: occupancies.label,
              accommodates: occupancies.accommodates,
              // Priced from today on: the calendar has at least one price ahead.
              priced: sql<boolean>`exists (
                select 1 from rate_calendar rc
                 where rc.occupancy_id = occupancies.id and rc.date >= current_date)`,
              booked: sql<boolean>`exists (select 1 from bookings b where b.occupancy_id = occupancies.id)`,
            })
            .from(occupancies)
            .where(
              inArray(
                occupancies.ratePlanId,
                plans.map((p) => p.id),
              ),
            )
            .orderBy(asc(occupancies.accommodates), asc(occupancies.label))
        : [];
      return plans.map((p) => ({
        ...p,
        occupancies: occ
          .filter((o) => o.ratePlanId === p.id)
          .map(({ ratePlanId: _plan, ...o }) => o),
      }));
    });
  }

  /**
   * Sell a room type under a rate type: the plan, and its first guest configurations (at least
   * one, so it can be priced straight away on the rates calendar).
   */
  createRatePlan(tenantId: string, propertyId: string, dto: CreateRatePlanDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx
        .select({
          id: rooms.id,
          name: rooms.name,
          propertyId: rooms.propertyId,
          baseAdults: rooms.baseAdults,
        })
        .from(rooms)
        .where(eq(rooms.id, dto.roomId));
      if (!room || room.propertyId !== propertyId)
        throw new NotFoundException('Room type not found');
      const [type] = await tx.select().from(rateTypes).where(eq(rateTypes.id, dto.rateTypeId));
      if (!type || type.propertyId !== propertyId)
        throw new NotFoundException('Rate type not found');
      const [dupe] = await tx
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(eq(ratePlans.roomId, room.id), eq(ratePlans.rateTypeId, type.id)));
      if (dupe) throw new ConflictException(`${room.name} is already sold under ${type.name}`);
      if (dto.marketSegmentId) {
        const [seg] = await tx
          .select({ id: marketSegments.id })
          .from(marketSegments)
          .where(eq(marketSegments.id, dto.marketSegmentId));
        if (!seg) throw new NotFoundException('Market segment not found');
      }
      const [plan] = await tx
        .insert(ratePlans)
        .values({
          tenantId,
          propertyId,
          roomId: room.id,
          rateCodeId: await this.rateCodeId(tx, type.mealPlan as MealPlan),
          rateTypeId: type.id,
          audience: dto.audience,
          marketSegmentId: dto.marketSegmentId ?? null,
        })
        .returning();
      const guests = dto.occupancies?.length
        ? dto.occupancies
        : [
            {
              label: defaultLabel(room.baseAdults ?? 2),
              accommodates: room.baseAdults ?? 2,
            },
          ];
      const created = await tx
        .insert(occupancies)
        .values(guests.map((g) => ({ tenantId, ratePlanId: plan!.id, ...g })))
        .returning();
      return { ...plan, occupancies: created };
    });
  }

  /** Delete a rate plan nothing was ever booked on; one in use is made inactive instead. */
  deleteRatePlan(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [plan] = await tx.select().from(ratePlans).where(eq(ratePlans.id, id)).for('update');
      if (!plan) throw new NotFoundException('Rate plan not found');
      const [used] = (await tx.execute(sql`
        select exists (
          select 1 from bookings b join occupancies o on o.id = b.occupancy_id
           where o.rate_plan_id = ${id}) as used`)) as unknown as Array<{ used: boolean }>;
      if (used?.used)
        throw new ConflictException({
          reason: 'rate_plan_booked',
          message:
            'This rate plan has bookings, so it cannot be deleted. Make it inactive to stop selling it.',
        });
      await tx.delete(ratePlans).where(eq(ratePlans.id, id));
      return { deleted: true, id };
    });
  }

  // --- Guest configurations (occupancies) ---------------------------------------------

  addOccupancy(tenantId: string, ratePlanId: string, dto: CreateOccupancyRowDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [plan] = await tx
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(eq(ratePlans.id, ratePlanId));
      if (!plan) throw new NotFoundException('Rate plan not found');
      const [row] = await tx
        .insert(occupancies)
        .values({ tenantId, ratePlanId, label: dto.label, accommodates: dto.accommodates })
        .returning();
      return row;
    });
  }

  updateOccupancy(tenantId: string, id: string, dto: UpdateOccupancyRowDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .update(occupancies)
        .set({
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.accommodates !== undefined && { accommodates: dto.accommodates }),
        })
        .where(eq(occupancies.id, id))
        .returning();
      if (!row) throw new NotFoundException('Guest configuration not found');
      return row;
    });
  }

  /** Remove a guest configuration never booked; its prices go with it. */
  deleteOccupancy(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(occupancies).where(eq(occupancies.id, id)).for('update');
      if (!row) throw new NotFoundException('Guest configuration not found');
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.occupancyId, id));
      if ((used?.n ?? 0) > 0)
        throw new ConflictException(
          'This guest configuration has bookings, so it cannot be removed.',
        );
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(occupancies)
        .where(eq(occupancies.ratePlanId, row.ratePlanId));
      if ((others?.n ?? 0) <= 1)
        throw new BadRequestException('A rate plan needs at least one guest configuration.');
      await tx.delete(occupancies).where(eq(occupancies.id, id));
      return { deleted: true, id };
    });
  }

  // --- helpers --------------------------------------------------------------------------

  private async assertProperty(tx: Tx, propertyId: string) {
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!p) throw new NotFoundException('Property not found');
  }

  private async rateCodeId(tx: Tx, meal: MealPlan): Promise<string> {
    const [code] = await tx
      .select({ id: rateCodes.id })
      .from(rateCodes)
      .where(eq(rateCodes.code, meal));
    if (!code) throw new BadRequestException(`The ${meal} meal plan is not set up`);
    return code.id;
  }

  private async rateTypeBooked(tx: Tx, id: string): Promise<boolean> {
    const [row] = (await tx.execute(sql`
      select exists (
        select 1 from bookings b
          join occupancies o on o.id = b.occupancy_id
          join rate_plans p on p.id = o.rate_plan_id
         where p.rate_type_id = ${id}) as used`)) as unknown as Array<{ used: boolean }>;
    return Boolean(row?.used);
  }
}

/** "Single", "Double", "Triple" … or "5 guests". */
function defaultLabel(n: number): string {
  return ['', 'Single', 'Double', 'Triple', 'Quad'][n] ?? `${n} guests`;
}

function rethrowCode(e: unknown, code: string | undefined): never {
  const pg = (e as { code?: string; cause?: { code?: string } }) ?? {};
  if ((pg.code ?? pg.cause?.code) === '23505')
    throw new ConflictException(`Another rate type already uses the short code "${code}"`);
  throw e;
}
