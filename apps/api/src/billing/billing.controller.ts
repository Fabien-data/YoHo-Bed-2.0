import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BillingService } from './billing.service';
import {
  setDistributionModeSchema,
  setPlanSchema,
  type SetDistributionModeDto,
  type SetPlanDto,
} from './dto';

/**
 * Subscription plan & entitlements — Yanolja's "Know Your Plan", plus the machine-readable
 * entitlement set the web app uses to hide modules the tenant has not bought.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Public catalogue (authenticated, but not tenant-scoped) — for the upgrade screen. */
  @Get('billing/plans')
  catalogue() {
    return this.billing.catalogue();
  }

  /** The active tenant's plan, subscription state, distribution mode and entitlements. */
  @Get('billing/plan')
  @UseGuards(TenantGuard)
  plan(@TenantId() tenantId: string) {
    return this.billing.forTenant(tenantId);
  }

  /** Just the entitlement set — what the app shell polls to decide which nav items to render. */
  @Get('billing/entitlements')
  @UseGuards(TenantGuard)
  entitlements(@TenantId() tenantId: string) {
    return this.billing.entitlements(tenantId);
  }

  @Post('staff/tenants/:tenantId/plan')
  @UseGuards(RolesGuard)
  @Roles('YOHO_STAFF', 'YOHO_ADMIN')
  setPlan(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(setPlanSchema)) dto: SetPlanDto,
  ) {
    return this.billing.setPlan(tenantId, dto.planCode);
  }

  @Post('staff/tenants/:tenantId/distribution-mode')
  @UseGuards(RolesGuard)
  @Roles('YOHO_STAFF', 'YOHO_ADMIN')
  setDistributionMode(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(setDistributionModeSchema)) dto: SetDistributionModeDto,
  ) {
    return this.billing.setDistributionMode(tenantId, dto.mode);
  }
}
