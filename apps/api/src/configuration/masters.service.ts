import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  applyRegionPreset,
  businessSources,
  ledgerAccounts,
  marketSegments,
  paymentMethods,
  properties,
  type Tx,
} from '@yohobed/db';
import { normalizePhone } from '@yohobed/locale';
import { DatabaseService } from '../database/database.service';
import type {
  CreateBusinessSourceDto,
  CreateMarketSegmentDto,
  CreatePaymentMethodDto,
  CreateSalesPersonDto,
  UpdateBusinessSourceDto,
  UpdateMarketSegmentDto,
  UpdatePaymentMethodDto,
  UpdateSalesPersonDto,
} from './dto';

const money = (n: number) => n.toFixed(4);

/**
 * Store phone numbers in E.164 so every screen can format and dial them. A local number is read in
 * the tenant's own country; anything that does not parse is kept as typed rather than dropped.
 */
function toE164(value: string | null | undefined, country?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return normalizePhone(raw, country)?.e164 ?? raw;
}

/** A unique-violation raised by the single insert/update of a request, turned into a 409. */
function rethrowUnique(e: unknown, message: string): never {
  if ((e as { code?: string })?.code === '23505') throw new ConflictException(message);
  throw e;
}

/**
 * The owner-maintained lists behind the reservation desk.
 *
 * Every write re-reads the ids it references under the tenant's RLS context before using them:
 * RLS checks the row being written, but a foreign-key check does not, so an unchecked id could
 * point one tenant's source at another tenant's segment.
 */
@Injectable()
export class MastersService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Business sources --------------------------------------------------------

  listBusinessSources(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(businessSources)
        .orderBy(asc(businessSources.sort), asc(businessSources.name)),
    );
  }

  createBusinessSource(tenantId: string, dto: CreateBusinessSourceDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.assertSegment(tx, dto.defaultMarketSegmentId);
      try {
        const [row] = await tx
          .insert(businessSources)
          .values({
            tenantId,
            shortCode: dto.shortCode,
            name: dto.name,
            category: dto.category,
            palette: dto.palette,
            registrationNo: dto.registrationNo || null,
            defaultMarketSegmentId: dto.defaultMarketSegmentId ?? null,
            commissionPlan: dto.commissionPlan ?? 'none',
            commissionValue: money(dto.commissionValue ?? 0),
            collectsTourismTax: dto.collectsTourismTax,
            sort: dto.sort ?? 1000,
            ...(dto.color && { color: dto.color }),
          })
          .returning();
        return row;
      } catch (e) {
        rethrowUnique(e, `A source with code "${dto.shortCode}" already exists`);
      }
    });
  }

  updateBusinessSource(tenantId: string, id: string, dto: UpdateBusinessSourceDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.assertSegment(tx, dto.defaultMarketSegmentId);
      const [row] = await tx
        .update(businessSources)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.palette !== undefined && { palette: dto.palette }),
          ...(dto.registrationNo !== undefined && { registrationNo: dto.registrationNo || null }),
          ...(dto.defaultMarketSegmentId !== undefined && {
            defaultMarketSegmentId: dto.defaultMarketSegmentId,
          }),
          ...(dto.commissionPlan !== undefined && { commissionPlan: dto.commissionPlan }),
          ...(dto.commissionValue !== undefined && {
            commissionValue: money(dto.commissionValue),
          }),
          ...(dto.collectsTourismTax !== undefined && {
            collectsTourismTax: dto.collectsTourismTax,
          }),
          ...(dto.sort !== undefined && { sort: dto.sort }),
          ...(dto.active !== undefined && { active: dto.active }),
          updatedAt: new Date(),
        })
        .where(eq(businessSources.id, id))
        .returning();
      if (!row) throw new NotFoundException('Business source not found');
      return row;
    });
  }

  // --- Market segments ---------------------------------------------------------

  listMarketSegments(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(marketSegments).orderBy(asc(marketSegments.sort), asc(marketSegments.name)),
    );
  }

  createMarketSegment(tenantId: string, dto: CreateMarketSegmentDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .insert(marketSegments)
          .values({
            tenantId,
            code: dto.code,
            name: dto.name,
            grp: dto.group,
            palette: dto.palette,
            excludedFromSold: dto.excludedFromSold,
            sort: dto.sort ?? 1000,
          })
          .returning();
        return row;
      } catch (e) {
        rethrowUnique(e, `A segment with code "${dto.code}" already exists`);
      }
    });
  }

  updateMarketSegment(tenantId: string, id: string, dto: UpdateMarketSegmentDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .update(marketSegments)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.group !== undefined && { grp: dto.group }),
          ...(dto.palette !== undefined && { palette: dto.palette }),
          ...(dto.excludedFromSold !== undefined && { excludedFromSold: dto.excludedFromSold }),
          ...(dto.sort !== undefined && { sort: dto.sort }),
          ...(dto.active !== undefined && { active: dto.active }),
          updatedAt: new Date(),
        })
        .where(eq(marketSegments.id, id))
        .returning();
      if (!row) throw new NotFoundException('Market segment not found');
      return row;
    });
  }

  // --- Payment methods ---------------------------------------------------------

  listPaymentMethods(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(paymentMethods).orderBy(asc(paymentMethods.sort), asc(paymentMethods.name)),
    );
  }

  createPaymentMethod(tenantId: string, dto: CreatePaymentMethodDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.assertProperty(tx, dto.propertyId);
      const [dupe] = await tx
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(eq(paymentMethods.code, dto.code));
      if (dupe)
        throw new ConflictException(`A payment method with code "${dto.code}" already exists`);
      if (dto.isDefaultCash) await this.clearDefaultCash(tx);
      const [row] = await tx
        .insert(paymentMethods)
        .values({
          tenantId,
          propertyId: dto.propertyId ?? null,
          code: dto.code,
          name: dto.name,
          shortName: dto.shortName,
          category: dto.category,
          requiresReference: dto.requiresReference,
          isDefaultCash: dto.isDefaultCash,
          isGuestAdvance: dto.isGuestAdvance,
          currency: dto.currency ?? null,
          sort: dto.sort ?? 1000,
        })
        .returning();
      return row;
    });
  }

  updatePaymentMethod(tenantId: string, id: string, dto: UpdatePaymentMethodDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [current] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, id));
      if (!current) throw new NotFoundException('Payment method not found');
      await this.assertProperty(tx, dto.propertyId);
      const category = dto.category ?? current.category;
      const isDefaultCash = dto.isDefaultCash ?? current.isDefaultCash;
      if (isDefaultCash && category !== 'cash') {
        throw new BadRequestException('Only a cash method can be the default cash method');
      }
      if (dto.isDefaultCash) await this.clearDefaultCash(tx, id);
      const [row] = await tx
        .update(paymentMethods)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.shortName !== undefined && { shortName: dto.shortName }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.propertyId !== undefined && { propertyId: dto.propertyId }),
          ...(dto.requiresReference !== undefined && { requiresReference: dto.requiresReference }),
          ...(dto.isDefaultCash !== undefined && { isDefaultCash: dto.isDefaultCash }),
          ...(dto.isGuestAdvance !== undefined && { isGuestAdvance: dto.isGuestAdvance }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.sort !== undefined && { sort: dto.sort }),
          ...(dto.active !== undefined && { active: dto.active }),
          updatedAt: new Date(),
        })
        .where(eq(paymentMethods.id, id))
        .returning();
      return row;
    });
  }

  // --- Sales persons -----------------------------------------------------------

  /**
   * Sales persons live in the city-ledger accounts table (type `sales_person`), exactly as in
   * Yanolja's Cashiering Centre. They are managed here as well because every plan attributes
   * reservations to a sales person, while the city ledger itself is a Pro module.
   */
  listSalesPersons(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: ledgerAccounts.id,
          code: ledgerAccounts.code,
          name: ledgerAccounts.name,
          email: ledgerAccounts.email,
          phone: ledgerAccounts.phone,
          mobile: ledgerAccounts.mobile,
          countryCode: ledgerAccounts.countryCode,
          active: ledgerAccounts.active,
        })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.type, 'sales_person'))
        .orderBy(asc(ledgerAccounts.name)),
    );
  }

  createSalesPerson(tenantId: string, dto: CreateSalesPersonDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [dupe] = await tx
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.code, dto.code));
      if (dupe) throw new ConflictException(`An account with code "${dto.code}" already exists`);
      const home = await this.homeProperty(tx);
      const [row] = await tx
        .insert(ledgerAccounts)
        .values({
          tenantId,
          type: 'sales_person',
          code: dto.code,
          name: dto.name,
          email: dto.email ?? null,
          phone: toE164(dto.phone, home?.countryCode),
          mobile: toE164(dto.mobile, home?.countryCode),
          countryCode: dto.countryCode ?? null,
          currency: home?.currency ?? 'LKR',
        })
        .returning();
      return row;
    });
  }

  updateSalesPerson(tenantId: string, id: string, dto: UpdateSalesPersonDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const home = await this.homeProperty(tx);
      const [row] = await tx
        .update(ledgerAccounts)
        .set({
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.phone !== undefined && { phone: toE164(dto.phone, home?.countryCode) }),
          ...(dto.mobile !== undefined && { mobile: toE164(dto.mobile, home?.countryCode) }),
          ...(dto.countryCode !== undefined && { countryCode: dto.countryCode }),
          ...(dto.active !== undefined && { active: dto.active }),
          updatedAt: new Date(),
        })
        .where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.type, 'sales_person')))
        .returning();
      if (!row) throw new NotFoundException('Sales person not found');
      return row;
    });
  }

  // --- Presets -----------------------------------------------------------------

  /** Add a country preset's missing entries. Never changes an existing entry. */
  applyPreset(tenantId: string, country: string) {
    return this.dbs.withTenant(tenantId, (tx) => applyRegionPreset(tx, tenantId, country));
  }

  // --- Helpers -----------------------------------------------------------------

  /** The tenant's oldest property — the anchor for its default country and currency. */
  private async homeProperty(tx: Tx) {
    const [p] = await tx
      .select({ countryCode: properties.countryCode, currency: properties.currency })
      .from(properties)
      .orderBy(asc(properties.createdAt))
      .limit(1);
    return p;
  }

  private async assertSegment(tx: Tx, id: string | null | undefined) {
    if (!id) return;
    const [seg] = await tx
      .select({ id: marketSegments.id })
      .from(marketSegments)
      .where(eq(marketSegments.id, id));
    if (!seg) throw new NotFoundException('Market segment not found');
  }

  private async assertProperty(tx: Tx, id: string | null | undefined) {
    if (!id) return;
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
  }

  /** There is one default cash method; choosing a new one retires the old. */
  private async clearDefaultCash(tx: Tx, exceptId?: string) {
    await tx
      .update(paymentMethods)
      .set({ isDefaultCash: false, updatedAt: new Date() })
      .where(
        exceptId
          ? and(eq(paymentMethods.isDefaultCash, true), ne(paymentMethods.id, exceptId))
          : eq(paymentMethods.isDefaultCash, true),
      );
  }
}
