import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@yohobed/domain';
import { BillingService } from '../billing/billing.service';
import type { TenantRequest } from '../tenancy/tenant.guard';
import { FEATURE_KEY } from './feature.decorator';

/**
 * Allows the request only if the active tenant's subscription grants every required feature.
 *
 * Must run AFTER TenantGuard — it reads `req.tenantId`. Staff roles are not exempt: a YoHo staff
 * member acting inside a tenant sees exactly what that tenant bought, so support never
 * accidentally demonstrates a module the customer cannot actually use.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<FeatureKey[]>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<TenantRequest>();
    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('No active tenant selected (set the x-tenant-id header)');
    }

    const { features } = await this.billing.entitlements(tenantId);
    const missing = required.filter((f) => !features[f]);
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Your plan does not include: ${missing.join(', ')}. Upgrade to enable it.`,
      );
    }
    return true;
  }
}
