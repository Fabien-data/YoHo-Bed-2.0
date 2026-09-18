import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  bookings,
  businessSources,
  ledgerAccounts,
  marketSegments,
  paymentMethods,
  properties,
  type PropertyTaxIds,
  type Tx,
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
          ...(dto.countryCode !== undefined && { countryCode: dto.countryCode }),
          stateCode: stateCode || null,
          ...(dto.state !== undefined && { state: dto.state || null }),
          ...(dto.address !== undefined && { address: dto.address || null }),
          ...(dto.city !== undefined && { city: dto.city || null }),
          ...(dto.zip !== undefined && { zip: dto.zip || null }),
          ...(dto.phone !== undefined && { phone: dto.phone || null }),
          ...(dto.email !== undefined && { email: dto.email || null }),
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

      const [sources, segments, methods, salesPersons] = await Promise.all([
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
