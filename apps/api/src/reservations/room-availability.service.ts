import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import {
  availabilityCalendar,
  bookingRooms,
  maintenanceBlocks,
  occupancies,
  properties,
  rateCalendar,
  rateCodes,
  ratePlans,
  roomUnits,
  rooms,
  smartPropertyPolicies,
  resolveForwardTaxesForDates,
  housekeepingAsOf,
} from '@yohobed/db';
import {
  applyLastMinuteDrop,
  audienceAllows,
  forwardNight,
  sumMoney,
  type RateAudience,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { eachNight } from '../common/dates';
import { localToday } from '../common/local-date';
import type { RoomAvailabilityQuery } from './dto';

/**
 * What the reservation form's room grid offers (Development Phase 02): for each room type, how
 * many are free for every night of the stay, the rate types the guest may be sold with their
 * nightly and stay prices, and which physical rooms are free to assign.
 *
 * Prices here are list prices, for choosing; the quote is the authority on what is charged.
 * Rate types for the other audience (a resident rate for a foreign guest) are left out; when the
 * guest's residency is not yet known only the rates open to everyone are offered, and the count of
 * the others is returned so the desk knows to ask.
 */
@Injectable()
export class RoomAvailabilityService {
  constructor(private readonly dbs: DatabaseService) {}

  get(tenantId: string, propertyId: string, q: RoomAvailabilityQuery) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [property] = await tx
        .select({
          id: properties.id,
          currency: properties.currency,
          taxMode: properties.taxMode,
          timezone: properties.timezone,
        })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!property) throw new NotFoundException('Property not found');
      const [smart] = await tx
        .select({
          document: smartPropertyPolicies.published,
          version: smartPropertyPolicies.publishedVersion,
        })
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, propertyId));

      const nights = eachNight(q.checkin, q.checkout);
      const roomRows = await tx
        .select({ id: rooms.id, name: rooms.name, quantity: rooms.quantity })
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId))
        .orderBy(asc(rooms.name));
      const roomIds = roomRows.map((r) => r.id);
      if (roomIds.length === 0) {
        return {
          propertyId,
          checkin: q.checkin,
          checkout: q.checkout,
          nights: nights.length,
          currency: property.currency,
          roomTypes: [],
        };
      }

      const [avail, plans, units, busy, blocked] = await Promise.all([
        tx
          .select({
            roomId: availabilityCalendar.roomId,
            date: availabilityCalendar.date,
            roomsToSell: availabilityCalendar.roomsToSell,
            status: availabilityCalendar.status,
            minStay: availabilityCalendar.minStay,
            maxStay: availabilityCalendar.maxStay,
          })
          .from(availabilityCalendar)
          .where(
            and(
              inArray(availabilityCalendar.roomId, roomIds),
              inArray(availabilityCalendar.date, nights),
            ),
          ),
        tx
          .select({
            ratePlanId: ratePlans.id,
            roomId: ratePlans.roomId,
            audience: ratePlans.audience,
            marketSegmentId: ratePlans.marketSegmentId,
            rateCode: rateCodes.code,
            rateName: rateCodes.name,
            sortOrder: rateCodes.sortOrder,
            occupancyId: occupancies.id,
            label: occupancies.label,
            accommodates: occupancies.accommodates,
          })
          .from(ratePlans)
          .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
          .innerJoin(occupancies, eq(occupancies.ratePlanId, ratePlans.id))
          .where(and(inArray(ratePlans.roomId, roomIds), eq(ratePlans.status, 'Active')))
          .orderBy(asc(rateCodes.sortOrder), asc(occupancies.accommodates)),
        tx
          .select({
            id: roomUnits.id,
            roomId: roomUnits.roomId,
            code: roomUnits.code,
            displayName: roomUnits.displayName,
            floor: roomUnits.floor,
            status: roomUnits.status,
          })
          .from(roomUnits)
          .where(eq(roomUnits.propertyId, propertyId))
          .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code)),
        tx
          .select({ unitId: bookingRooms.roomUnitId })
          .from(bookingRooms)
          .innerJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
          .where(
            and(
              eq(roomUnits.propertyId, propertyId),
              isNull(bookingRooms.releasedAt),
              lt(bookingRooms.checkin, q.checkout),
              gt(bookingRooms.checkout, q.checkin),
            ),
          ),
        tx
          .select({ unitId: maintenanceBlocks.roomUnitId })
          .from(maintenanceBlocks)
          .where(
            and(
              eq(maintenanceBlocks.propertyId, propertyId),
              isNull(maintenanceBlocks.releasedAt),
              lt(maintenanceBlocks.blockFrom, q.checkout),
              gt(maintenanceBlocks.blockTo, q.checkin),
            ),
          ),
      ]);

      const occupancyIds = [
        ...new Set(
          plans.map((p) => smart?.document?.rates[p.occupancyId]?.baseOccupancyId ?? p.occupancyId),
        ),
      ];
      const prices = occupancyIds.length
        ? await tx
            .select({
              occupancyId: rateCalendar.occupancyId,
              date: rateCalendar.date,
              sellingPrice: rateCalendar.sellingPrice,
              netPrice: rateCalendar.netPrice,
              lastMinuteDropPct: rateCalendar.lastMinuteDropPct,
            })
            .from(rateCalendar)
            .where(
              and(
                inArray(rateCalendar.occupancyId, occupancyIds),
                inArray(rateCalendar.date, nights),
              ),
            )
        : [];
      // Forward-taxed properties (Sprint 7) drop the pre-tax price, then tax it, as the pricer does.
      const forwardTaxes =
        property.taxMode === 'exclusive_forward'
          ? await resolveForwardTaxesForDates(tx, propertyId, nights)
          : null;
      const priceOf = new Map(
        prices.map((p) => [
          `${p.occupancyId}|${p.date}`,
          forwardTaxes && p.netPrice !== null
            ? forwardNight(
                applyLastMinuteDrop(Number(p.netPrice), Number(p.lastMinuteDropPct)),
                forwardTaxes.get(p.date) ?? [],
              ).selling
            : applyLastMinuteDrop(Number(p.sellingPrice), Number(p.lastMinuteDropPct)),
        ]),
      );
      const busyUnits = new Set(busy.map((b) => b.unitId));
      const blockedUnits = new Set(blocked.map((b) => b.unitId));
      const housekeeping = await housekeepingAsOf(tx, propertyId, localToday(property.timezone));

      const roomTypes = roomRows.map((room) => {
        const days = avail.filter((a) => a.roomId === room.id);
        const byDate = new Map(days.map((d) => [d.date, d]));
        const closedDates = nights.filter((d) => byDate.get(d)?.status !== 'Open');
        const free = Math.min(
          ...nights.map((d) => {
            const a = byDate.get(d);
            return a && a.status === 'Open' ? a.roomsToSell : 0;
          }),
        );
        const arrival = byDate.get(nights[0]!);

        const roomPlans = plans.filter((p) => p.roomId === room.id);
        const offered = roomPlans.filter((p) =>
          audienceAllows(p.audience as RateAudience, q.residency ?? null),
        );
        const rateTypes = offered.map((p) => {
          const smartRule = smart?.document?.rates[p.occupancyId];
          const nightly = nights.map((d) => ({
            date: d,
            price: priceOf.get(`${smartRule?.baseOccupancyId ?? p.occupancyId}|${d}`),
          }));
          const priced = nightly.every((n) => n.price !== undefined);
          const total = priced && !smartRule ? sumMoney(nightly.map((n) => n.price!)) : null;
          return {
            ratePlanId: p.ratePlanId,
            occupancyId: p.occupancyId,
            rateCode: p.rateCode,
            rateName: p.rateName,
            label: p.label,
            accommodates: p.accommodates,
            audience: p.audience,
            marketSegmentId: p.marketSegmentId,
            priced,
            requiresGuestQuote: !!smartRule,
            policyVersion: smart?.version ?? null,
            nightly: nightly.map((n) => ({
              date: n.date,
              price: smartRule ? null : (n.price?.toFixed(2) ?? null),
            })),
            total: total?.toFixed(2) ?? null,
            average: total !== null ? (total / nights.length).toFixed(2) : null,
          };
        });

        return {
          roomId: room.id,
          name: room.name,
          quantity: room.quantity,
          free: Math.max(0, free),
          closedDates,
          minStay: arrival?.minStay ?? 1,
          maxStay: arrival?.maxStay ?? 0,
          rateTypes,
          /** Rate types kept back because they are for the other residency (or it is unknown). */
          hiddenRateTypes: roomPlans.length - offered.length,
          units: units
            .filter((u) => u.roomId === room.id)
            .map((u) => ({
              id: u.id,
              code: u.code,
              displayName: u.displayName,
              floor: u.floor,
              free: u.status === 'active' && !busyUnits.has(u.id) && !blockedUnits.has(u.id),
              outOfService: u.status !== 'active',
              blocked: blockedUnits.has(u.id),
              housekeeping: housekeeping.get(u.id)?.status ?? 'clean',
            })),
        };
      });

      return {
        propertyId,
        checkin: q.checkin,
        checkout: q.checkout,
        nights: nights.length,
        currency: property.currency,
        roomTypes,
      };
    });
  }
}
