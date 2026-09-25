import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  bookings,
  businessSources,
  ledgerAccounts,
  media,
  marketSegments,
  paymentMethods,
  properties,
  type PropertyTaxIds,
  type Tx,
  cashDrawers,
  drawerSessions,
  transportModes,
} from '@yohobed/db';
import {
  RESERVATION_KINDS,
  RESERVATION_KIND_META,
  resolveKindDisplay,
  resolvePropertySettings,
  type PropertySettings,
} from '@yohobed/domain';
import { isHomeMarket, isSubdivisionOf, presetFor, titlesFor } from '@yohobed/locale';
import { DatabaseService } from '../database/database.service';
import { localToday, propertyBusinessDate } from '../common/local-date';
import type { UpdatePropertyProfileDto, UpdatePropertySettingsDto } from './dto';

@Injectable()
export class ConfigurationService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Property profile ------------------------------------------------------

  /**
   * Update a property's identity: address block, regional identity, registration numbers.
   *
   * The country is locked once the property has taken a booking, like its currency: it selects
   * the tax and invoice profile, and changing it under existing bookings would re-label their
   * money after the fact.
   */
  updateProfile(tenantId: string, propertyId: string, dto: UpdatePropertyProfileDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const current = await this.loadProperty(tx, propertyId);
      const country = dto.countryCode ?? current.countryCode;

      const latitude = dto.latitude === undefined ? current.latitude : dto.latitude;
      const longitude = dto.longitude === undefined ? current.longitude : dto.longitude;
      if ((latitude === null) !== (longitude === null)) {
        throw new BadRequestException('Latitude and longitude must be provided together');
      }
      if (dto.logoMediaId) {
        const [logo] = await tx
          .select({ id: media.id, sizeBytes: media.sizeBytes })
          .from(media)
          .where(
            and(
              eq(media.id, dto.logoMediaId),
              eq(media.tenantId, tenantId),
              eq(media.propertyId, propertyId),
              isNull(media.roomId),
            ),
          );
        if (!logo) throw new BadRequestException('Logo must be a photo of this property');
        if (logo.sizeBytes > 1024 * 1024)
          throw new BadRequestException('Logo must be smaller than 1 MB');
      }

      if (dto.countryCode && dto.countryCode !== current.countryCode) {
        const [used] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(eq(bookings.propertyId, propertyId))
          .limit(1);
        if (used) {
          throw new ConflictException({
            reason: 'country_locked',
            message: 'The country cannot change once the property has bookings',
          });
        }
      }

      // A state code only means something inside its country; re-check it whenever either moves.
      const stateCode =
        dto.stateCode !== undefined
          ? dto.stateCode
          : dto.countryCode && dto.countryCode !== current.countryCode
            ? null
            : current.stateCode;
      if (stateCode && isHomeMarket(country) && !isSubdivisionOf(country, stateCode)) {
        throw new BadRequestException(`"${stateCode}" is not a state of ${country}`);
      }

      const taxIds: PropertyTaxIds | undefined = dto.taxIds
        ? compact({ ...(current.taxIds ?? {}), ...dto.taxIds })
        : undefined;

      const [row] = await tx
        .update(properties)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.legalName !== undefined && { legalName: dto.legalName || null }),
          ...(dto.code !== undefined && { code: dto.code || null }),
          ...(dto.propertyType !== undefined && { propertyType: dto.propertyType }),
          ...(dto.countryCode !== undefined && { countryCode: dto.countryCode }),
          stateCode: stateCode || null,
          ...(dto.state !== undefined && { state: dto.state || null }),
          ...(dto.address !== undefined && { address: dto.address || null }),
          ...(dto.addressLine2 !== undefined && { addressLine2: dto.addressLine2 || null }),
          ...(dto.city !== undefined && { city: dto.city || null }),
          ...(dto.zip !== undefined && { zip: dto.zip || null }),
          ...(dto.phone !== undefined && { phone: dto.phone || null }),
          ...(dto.reservationPhone !== undefined && {
            reservationPhone: dto.reservationPhone || null,
          }),
          ...(dto.email !== undefined && { email: dto.email || null }),
          ...(dto.website !== undefined && { website: dto.website || null }),
          ...(dto.fax !== undefined && { fax: dto.fax || null }),
          ...(dto.registrationNumber !== undefined && {
            registrationNumber: dto.registrationNumber || null,
          }),
          ...(dto.additionalRegistrationNumbers !== undefined && {
            additionalRegistrationNumbers: dto.additionalRegistrationNumbers,
          }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.logoMediaId !== undefined && { logoMediaId: dto.logoMediaId }),
          ...(dto.timezone !== undefined && { timezone: dto.timezone }),
          ...(dto.checkinTime !== undefined && { checkinTime: `${dto.checkinTime}:00` }),
          ...(dto.checkoutTime !== undefined && { checkoutTime: `${dto.checkoutTime}:00` }),
          ...(dto.starRating !== undefined && { starRating: dto.starRating }),
          ...(taxIds !== undefined && { taxIds }),
          ...(dto.branchCode !== undefined && { branchCode: dto.branchCode || null }),
          ...(dto.fyStartMonth !== undefined && { fyStartMonth: dto.fyStartMonth }),
          ...(dto.invoicePrefix !== undefined && { invoicePrefix: dto.invoicePrefix || null }),
          updatedAt: new Date(),
        })
        .where(eq(properties.id, propertyId))
        .returning();
      return row;
    });
  }

  // --- Settings --------------------------------------------------------------

  getSettings(tenantId: string, propertyId: string): Promise<PropertySettings> {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const p = await this.loadProperty(tx, propertyId);
      return resolvePropertySettings(p.settings);
    });
  }

  /** Partial update: only the keys sent change; the stored object is always the resolved shape. */
  updateSettings(tenantId: string, propertyId: string, dto: UpdatePropertySettingsDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const p = await this.loadProperty(tx, propertyId);
      const current = resolvePropertySettings(p.settings);
      const merged = resolvePropertySettings({
        ...current,
        ...dto,
        hold: { ...current.hold, ...dto.hold },
        rateControl: { ...current.rateControl, ...dto.rateControl },
        nightAudit: { ...current.nightAudit, ...dto.nightAudit },
        kindOverrides:
          dto.kindOverrides === undefined
            ? current.kindOverrides
            : { ...current.kindOverrides, ...dto.kindOverrides },
        titles: dto.titles === undefined ? current.titles : dto.titles,
      });
      await tx
        .update(properties)
        .set({ settings: merged as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(properties.id, propertyId));
      return merged;
    });
  }

  // --- Reservation config ------------------------------------------------------

  /**
   * Everything the reservation screens need, in one call: the property's operating date and
   * times, its settings, the kinds with their labels, and the active master lists.
   *
   * Deliberately ungated (every plan takes reservations) and readable by desk staff. The
   * business date comes from night audit when the property runs it, so the date picker greys out
   * exactly the days the hotel has already closed.
   */
  reservationConfig(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const p = await this.loadProperty(tx, propertyId);
      const settings = resolvePropertySettings(p.settings);
      const today = await propertyBusinessDate(tx, propertyId, p.timezone);
      const preset = presetFor(p.countryCode);

      const [sources, segments, methods, salesPersons, accounts, drawers, modes] =
        await Promise.all([
          tx
            .select({
              id: businessSources.id,
              shortCode: businessSources.shortCode,
              name: businessSources.name,
              category: businessSources.category,
              palette: businessSources.palette,
              defaultMarketSegmentId: businessSources.defaultMarketSegmentId,
              collectsTourismTax: businessSources.collectsTourismTax,
            })
            .from(businessSources)
            .where(eq(businessSources.active, true))
            .orderBy(asc(businessSources.sort), asc(businessSources.name)),
          tx
            .select({
              id: marketSegments.id,
              code: marketSegments.code,
              name: marketSegments.name,
              group: marketSegments.grp,
              palette: marketSegments.palette,
              excludedFromSold: marketSegments.excludedFromSold,
            })
            .from(marketSegments)
            .where(eq(marketSegments.active, true))
            .orderBy(asc(marketSegments.sort), asc(marketSegments.name)),
          tx
            .select({
              id: paymentMethods.id,
              code: paymentMethods.code,
              name: paymentMethods.name,
              shortName: paymentMethods.shortName,
              category: paymentMethods.category,
              requiresReference: paymentMethods.requiresReference,
              isDefaultCash: paymentMethods.isDefaultCash,
              isGuestAdvance: paymentMethods.isGuestAdvance,
              currency: paymentMethods.currency,
            })
            .from(paymentMethods)
            .where(
              and(
                eq(paymentMethods.active, true),
                or(isNull(paymentMethods.propertyId), eq(paymentMethods.propertyId, propertyId)),
              ),
            )
            .orderBy(asc(paymentMethods.sort), asc(paymentMethods.name)),
          tx
            .select({ id: ledgerAccounts.id, code: ledgerAccounts.code, name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.type, 'sales_person'),
                eq(ledgerAccounts.active, true),
                or(isNull(ledgerAccounts.propertyId), eq(ledgerAccounts.propertyId, propertyId)),
              ),
            )
            .orderBy(asc(ledgerAccounts.name)),
          // Travel agents and companies a reservation can be made for. Names only: the city ledger
          // itself (balances, statements) stays on the Pro plan.
          tx
            .select({
              id: ledgerAccounts.id,
              code: ledgerAccounts.code,
              name: ledgerAccounts.name,
              type: ledgerAccounts.type,
              defaultMarketSegmentId: ledgerAccounts.defaultMarketSegmentId,
              hasContractRates: sql<boolean>`exists (
              select 1 from ledger_account_rates lar
              where lar.ledger_account_id = ${ledgerAccounts.id} and lar.active
                and lar.property_id = ${propertyId}
            )`,
            })
            .from(ledgerAccounts)
            .where(
              and(
                inArray(ledgerAccounts.type, ['travel_agent', 'company']),
                eq(ledgerAccounts.active, true),
                or(isNull(ledgerAccounts.propertyId), eq(ledgerAccounts.propertyId, propertyId)),
              ),
            )
            .orderBy(asc(ledgerAccounts.name)),
          // The tills open right now, so the form can say where cash will go (Sprint 5).
          tx
            .select({
              sessionId: drawerSessions.id,
              drawerName: cashDrawers.name,
              openedByUserId: drawerSessions.openedByUserId,
              openedAt: drawerSessions.openedAt,
            })
            .from(drawerSessions)
            .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
            .where(and(eq(cashDrawers.propertyId, propertyId), eq(drawerSessions.status, 'open')))
            .orderBy(asc(cashDrawers.name)),
          tx
            .select({
              id: transportModes.id,
              code: transportModes.code,
              name: transportModes.name,
              defaultPrice: transportModes.defaultPrice,
            })
            .from(transportModes)
            .where(eq(transportModes.active, true))
            .orderBy(asc(transportModes.sort), asc(transportModes.name)),
        ]);

      return {
        property: {
          id: p.id,
          name: p.name,
          code: p.code,
          legalName: p.legalName,
          countryCode: p.countryCode,
          stateCode: p.stateCode,
          currency: p.currency,
          timezone: p.timezone,
          checkinTime: p.checkinTime.slice(0, 5),
          checkoutTime: p.checkoutTime.slice(0, 5),
        },
        /** The operating date: night audit's business date, or the property's calendar today. */
        today: today.date,
        todaySource: today.source,
        calendarToday: localToday(p.timezone),
        settings,
        kinds: RESERVATION_KINDS.map((kind) => {
          const meta = RESERVATION_KIND_META[kind];
          const display = resolveKindDisplay(kind, settings.kindOverrides);
          return {
            kind,
            label: display.label,
            shortLabel: display.shortLabel,
            color: display.color,
            holdsInventory: meta.holdsInventory,
            isHold: meta.isHold,
            quick: meta.quick,
          };
        }),
        titles: settings.titles ?? titlesFor(p.countryCode),
        region: {
          country: preset.country,
          cityLedgerLabel: preset.cityLedgerLabel,
          taxRegistrationLabel: preset.taxRegistrationLabel,
        },
        businessSources: sources,
        marketSegments: segments,
        paymentMethods: methods,
        salesPersons,
        accounts,
        openDrawers: drawers,
        transportModes: modes,
      };
    });
  }

  private async loadProperty(tx: Tx, id: string) {
    const [p] = await tx.select().from(properties).where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }
}

/** Drop empty registration numbers so a cleared field removes the key rather than storing ''. */
function compact(ids: Record<string, string | undefined>): PropertyTaxIds {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ids)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out as PropertyTaxIds;
}
