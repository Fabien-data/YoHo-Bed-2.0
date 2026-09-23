import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  properties,
  propertyLevies,
  propertyTaxTypes,
  taxDurations,
  taxTypes,
  type Tx,
} from '@yohobed/db';
import { resolvePropertySettings } from '@yohobed/domain';
import { isHomeMarket, presetFor } from '@yohobed/locale';
import { DatabaseService } from '../database/database.service';
import { propertyBusinessDate } from '../common/local-date';
import { RatesService } from './rates.service';

/** The last day a preset rate runs to: open-ended in practice. */
const OPEN_END = '2099-12-31';

/**
 * The countries whose tax presets may be applied. Malaysia's and India's rules are switched on
 * for live hotels only after a tax adviser signs them off (Phase 02 plan, S7 acceptance), so the
 * platform names them in `REGIONAL_TAX_COUNTRIES` (e.g. `MY,IN`); unset, none are.
 */
export function regionalTaxCountries(): string[] {
  return (process.env.REGIONAL_TAX_COUNTRIES ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Taxes and levies (Development Phase 02, Sprint 7): what a property charges, and applying its
 * country's preset — the forward tax engine, the taxes, the tourism tax — in one step.
 */
@Injectable()
export class TaxesService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly rates: RatesService,
  ) {}

  overview(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.overviewWithin(tx, propertyId));
  }

  /**
   * Apply the property's country tax preset: switch it to the forward engine, set up its taxes
   * (slabs included) and levies, turn on the guest register where the law asks for it, and
   * re-price the rate calendar from today on. Bookings already made keep the prices they were
   * sold at — their nights are snapshots.
   */
  applyPreset(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const p = await this.property(tx, propertyId);
      const preset = isHomeMarket(p.countryCode) ? presetFor(p.countryCode) : null;
      if (!preset?.tax) {
        throw new BadRequestException({
          reason: 'no_tax_preset',
          message:
            p.countryCode === 'LK'
              ? "Sri Lanka's taxes run on the inclusive engine and are set up tax by tax."
              : `There is no tax preset for ${p.countryCode}.`,
        });
      }
      if (!regionalTaxCountries().includes(p.countryCode)) {
        throw new ConflictException({
          reason: 'region_not_enabled',
          message: `Taxes for ${p.countryCode} are waiting for a tax adviser's sign-off and cannot be switched on yet.`,
        });
      }
      const currency = preset.baseCurrencies[0]!;
      if (p.currency !== currency) {
        throw new ConflictException({
          reason: 'currency_mismatch',
          message: `This property prices in ${p.currency}; its ${p.countryCode} taxes need ${currency}. Ask YoHo to change the property's currency first.`,
        });
      }

      // The property's old tax links go; the tax types are the tenant's and may serve others.
      await tx.delete(propertyTaxTypes).where(eq(propertyTaxTypes.propertyId, propertyId));
      for (const seed of preset.tax.taxes) {
        const [existing] = await tx
          .select({ id: taxTypes.id })
          .from(taxTypes)
          .where(and(eq(taxTypes.code, seed.code), eq(taxTypes.name, seed.name)));
        const flags = {
          compound: seed.compound,
          exemptible: seed.exemptible,
          displayGroup: seed.displayGroup,
          invoiceLabel: seed.invoiceLabel ?? null,
        };
        const typeId = existing
          ? (
              await tx.update(taxTypes).set(flags).where(eq(taxTypes.id, existing.id)).returning()
            )[0]!.id
          : (
              await tx
                .insert(taxTypes)
                .values({ tenantId, name: seed.name, code: seed.code, ...flags })
                .returning()
            )[0]!.id;
        await tx.delete(taxDurations).where(eq(taxDurations.taxTypeId, typeId));
        await tx.insert(taxDurations).values(
          seed.rates.map((r) => ({
            tenantId,
            taxTypeId: typeId,
            startDate: seed.from,
            endDate: OPEN_END,
            ratePercent: r.ratePercent.toFixed(4),
            minAmount: r.minAmount === undefined ? null : r.minAmount.toFixed(2),
            maxAmount: r.maxAmount === undefined ? null : r.maxAmount.toFixed(2),
          })),
        );
        await tx
          .insert(propertyTaxTypes)
          .values({ tenantId, propertyId, taxTypeId: typeId, priority: seed.priority });
      }

      for (const levy of preset.tax.levies) {
        const values = {
          name: levy.name,
          amount: levy.amount.toFixed(2),
          currency: levy.currency,
          appliesTo: levy.appliesTo,
          validFrom: levy.from,
          validTo: null,
          active: true,
          updatedAt: new Date(),
        };
        await tx
          .insert(propertyLevies)
          .values({ tenantId, propertyId, code: levy.code, ...values })
          .onConflictDoUpdate({
            target: [propertyLevies.propertyId, propertyLevies.code],
            set: values,
          });
      }

      const settings = resolvePropertySettings({
        ...resolvePropertySettings(p.settings),
        requireGuestRegistration: preset.tax.requireGuestRegistration,
      });
      await tx
        .update(properties)
        .set({
          taxMode: preset.tax.taxMode,
          settings: settings as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(properties.id, propertyId));

      const today = (await propertyBusinessDate(tx, propertyId, p.timezone)).date;
      const repriced = await this.rates.repriceFrom(tx, propertyId, today);
      return { ...(await this.overviewWithin(tx, propertyId)), repriced, repricedFrom: today };
    });
  }

  private async overviewWithin(tx: Tx, propertyId: string) {
    const p = await this.property(tx, propertyId);
    const links = await tx
      .select({
        id: taxTypes.id,
        name: taxTypes.name,
        code: taxTypes.code,
        invoiceLabel: taxTypes.invoiceLabel,
        priority: propertyTaxTypes.priority,
        compound: taxTypes.compound,
        exemptible: taxTypes.exemptible,
        displayGroup: taxTypes.displayGroup,
      })
      .from(propertyTaxTypes)
      .innerJoin(taxTypes, eq(taxTypes.id, propertyTaxTypes.taxTypeId))
      .where(eq(propertyTaxTypes.propertyId, propertyId))
      .orderBy(asc(propertyTaxTypes.priority), asc(taxTypes.name));
    const durations = links.length
      ? await tx
          .select()
          .from(taxDurations)
          .where(
            inArray(
              taxDurations.taxTypeId,
              links.map((l) => l.id),
            ),
          )
          .orderBy(asc(taxDurations.startDate), asc(taxDurations.minAmount))
      : [];
    const levies = await tx
      .select()
      .from(propertyLevies)
      .where(eq(propertyLevies.propertyId, propertyId))
      .orderBy(asc(propertyLevies.code));
    const preset = isHomeMarket(p.countryCode) ? presetFor(p.countryCode) : null;
    return {
      propertyId,
      countryCode: p.countryCode,
      currency: p.currency,
      taxMode: p.taxMode,
      taxes: links.map((l) => ({
        ...l,
        rates: durations
          .filter((d) => d.taxTypeId === l.id)
          .map((d) => ({
            ratePercent: Number(d.ratePercent),
            minAmount: d.minAmount === null ? null : Number(d.minAmount),
            maxAmount: d.maxAmount === null ? null : Number(d.maxAmount),
            startDate: d.startDate,
            endDate: d.endDate,
          })),
      })),
      levies: levies.map((l) => ({
        code: l.code,
        name: l.name,
        amount: l.amount,
        currency: l.currency,
        appliesTo: l.appliesTo,
        validFrom: l.validFrom,
        validTo: l.validTo,
        active: l.active,
      })),
      preset: {
        available: Boolean(preset?.tax),
        enabled: regionalTaxCountries().includes(p.countryCode),
        currency: preset?.baseCurrencies[0] ?? null,
        applied: p.taxMode === 'exclusive_forward',
      },
    };
  }

  private async property(tx: Tx, id: string) {
    const [p] = await tx.select().from(properties).where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }
}
