import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  auditLog,
  quoteSmartStay,
  occupancies,
  properties,
  rateCodes,
  ratePlans,
  rooms,
  smartPropertyPolicies,
  type Tx,
} from '@yohobed/db';
import {
  roomPolicyFor,
  validateSmartPolicy,
  type SmartPropertyDocument,
  type SmartIssue,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { eachNight } from '../common/dates';
import type { SaveSmartDraftDto, SmartPreviewDto, PublishSmartDto } from './smart-setup.dto';

@Injectable()
export class SmartSetupService {
  constructor(private readonly db: DatabaseService) {}

  private async property(tx: Tx, propertyId: string) {
    const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async configuration(tenantId: string, propertyId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const property = await this.property(tx, propertyId);
      const [policy] = await tx
        .select()
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, propertyId));
      const categories = await tx
        .select({ id: rooms.id, name: rooms.name, quantity: rooms.quantity })
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId));
      const rates = await this.rateOptions(tx, propertyId);
      return {
        property: { id: property.id, name: property.name, currency: property.currency },
        categories,
        rates,
        policy: policy ?? null,
        issues: policy ? await this.validate(tx, propertyId, policy.draft) : [],
      };
    });
  }

  private rateOptions(tx: Tx, propertyId: string) {
    return tx
      .select({
        id: occupancies.id,
        label: occupancies.label,
        roomId: ratePlans.roomId,
        code: rateCodes.code,
        audience: ratePlans.audience,
        status: ratePlans.status,
      })
      .from(occupancies)
      .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
      .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
      .where(eq(ratePlans.propertyId, propertyId));
  }

  async validate(
    tx: Tx,
    propertyId: string,
    document: SmartPropertyDocument,
  ): Promise<SmartIssue[]> {
    const issues = validateSmartPolicy(document.defaults).map((issue) => ({
      ...issue,
      field: 'defaults.' + issue.field,
    }));
    const categories = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.propertyId, propertyId));
    const ids = new Set(categories.map((room) => room.id));
    const fail = (field: string, message: string) =>
      issues.push({ field, code: 'invalid_mapping', message });
    for (const [id, policy] of Object.entries(document.roomOverrides)) {
      if (!ids.has(id)) fail('roomOverrides.' + id, 'Category does not belong to this property.');
      issues.push(
        ...validateSmartPolicy(policy).map((issue) => ({
          ...issue,
          field: 'roomOverrides.' + id + '.' + issue.field,
        })),
      );
    }
    const options = await this.rateOptions(tx, propertyId);
    const rates = new Map(options.map((rate) => [rate.id, rate]));
    for (const option of options.filter((rate) => rate.status === 'Active')) {
      if (!document.rates[option.id])
        fail(
          'rates.' + option.id,
          'Review the adult/child inclusions and meal rules for ' +
            option.label +
            ' (' +
            option.code +
            ').',
        );
    }
    for (const [id, rate] of Object.entries(document.rates)) {
      const option = rates.get(id);
      const base = rates.get(rate.baseOccupancyId);
      if (!option || option.roomId !== rate.roomId || option.code !== rate.meal.code)
        fail('rates.' + id, 'Rate mapping must match its existing category and meal plan.');
      if (
        !base ||
        base.roomId !== rate.roomId ||
        base.audience !== option?.audience ||
        (rate.meal.mode === 'derived' ? base.code !== 'RO' : base.id !== id)
      )
        fail(
          'rates.' + id + '.baseOccupancyId',
          'Derived plans require an RO rate in the same category and audience; independent plans use their own rate.',
        );
      const baseRule = document.rates[rate.baseOccupancyId];
      if (
        rate.meal.mode === 'derived' &&
        baseRule &&
        (baseRule.includedAdults !== rate.includedAdults ||
          baseRule.includedChildren !== rate.includedChildren)
      )
        fail(
          'rates.' + id,
          'A derived plan must use the same included guest places as its RO base to avoid charging an inclusion twice.',
        );
      issues.push(
        ...validateSmartPolicy(roomPolicyFor(document, id)!, rate.meal).map((issue) => ({
          ...issue,
          field: 'rates.' + id + '.' + issue.field,
        })),
      );
    }
    return issues;
  }

  async save(tenantId: string, propertyId: string, actorId: string, dto: SaveSmartDraftDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      // Serialize first creation as well as later edits; a stale editor never overwrites a draft.
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .for('update');
      if (!property) throw new NotFoundException('Property not found');
      const [current] = await tx
        .select()
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, propertyId));
      if ((current?.draftVersion ?? 0) !== dto.expectedVersion)
        throw new ConflictException('The setup was changed by another user. Reload before saving.');
      const values = {
        draft: dto.document,
        draftVersion: dto.expectedVersion + 1,
        updatedAt: new Date(),
      };
      const [saved] = current
        ? await tx
            .update(smartPropertyPolicies)
            .set(values)
            .where(eq(smartPropertyPolicies.propertyId, propertyId))
            .returning()
        : await tx
            .insert(smartPropertyPolicies)
            .values({ tenantId, propertyId, ...values })
            .returning();
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'smart_setup.draft_saved',
        entity: 'property',
        entityId: propertyId,
        detail: { version: values.draftVersion },
      });
      return { policy: saved, issues: await this.validate(tx, propertyId, dto.document) };
    });
  }

  async preview(tenantId: string, propertyId: string, dto: SmartPreviewDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const property = await this.property(tx, propertyId);
      const [policy] = await tx
        .select()
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, propertyId));
      if (!policy || policy.draftVersion !== dto.expectedVersion)
        throw new ConflictException('Save the latest draft before trying this booking.');
      const allIssues = await this.validate(tx, propertyId, policy.draft);
      const room = roomPolicyFor(policy.draft, dto.occupancyId);
      const rate = policy.draft.rates[dto.occupancyId];
      if (!room || !rate)
        throw new BadRequestException('Configure this guest rate before previewing it.');
      const issues = allIssues.filter(
        (issue) =>
          issue.field.startsWith('defaults.') ||
          issue.field.startsWith('roomOverrides.' + rate.roomId + '.') ||
          issue.field.startsWith('rates.' + dto.occupancyId + '.') ||
          issue.field === 'rates.' + dto.occupancyId ||
          issue.field.startsWith('rates.' + rate.baseOccupancyId + '.'),
      );
      if (issues.length)
        return {
          eligible: false,
          issues,
          nights: [],
          currency: property.currency,
          policyVersion: policy.draftVersion,
          totalNetMinor: 0,
          guestTotalMinor: 0,
        };
      const dates = eachNight(dto.checkin, dto.checkout);
      let result;
      try {
        result = await quoteSmartStay(tx, {
          propertyId,
          occupancyId: dto.occupancyId,
          dates,
          guests: dto.guests,
          draft: { document: policy.draft, version: policy.draftVersion },
        });
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      return {
        eligible: result!.eligible,
        issues: result!.issues,
        nights: result!.nights,
        currency: property.currency,
        policyVersion: policy.draftVersion,
        totalNetMinor: result!.nights.reduce((sum, night) => sum + night.quote.totalNetMinor, 0),
        guestTotalMinor: result!.nights.reduce(
          (sum, night) => sum + night.economics.guestTotalMinor,
          0,
        ),
      };
    });
  }

  async publish(tenantId: string, propertyId: string, actorId: string, dto: PublishSmartDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      await this.property(tx, propertyId);
      const [policy] = await tx
        .select()
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, propertyId))
        .for('update');
      if (!policy || policy.draftVersion !== dto.expectedVersion)
        throw new ConflictException('Setup changed. Review the latest draft before publishing.');
      const issues = await this.validate(tx, propertyId, policy.draft);
      if (issues.length)
        throw new BadRequestException({
          message: 'Resolve the setup issues before publishing.',
          issues,
        });
      const [saved] = await tx
        .update(smartPropertyPolicies)
        .set({
          published: policy.draft,
          publishedVersion: policy.draftVersion,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(smartPropertyPolicies.propertyId, propertyId))
        .returning();
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'smart_setup.published',
        entity: 'property',
        entityId: propertyId,
        detail: {
          previousVersion: policy.publishedVersion,
          version: policy.draftVersion,
          channelPublishing: 'unsupported',
        },
      });
      return {
        policy: saved,
        channelPublishing: {
          supported: false,
          reason:
            'The connected adapter cannot publish guest-policy prices. PMS policies are active; channel rate pushes are blocked until a compatible mapping is verified.',
        },
      };
    });
  }
}
