import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { NightAuditService } from './nightaudit.service';
import { revenueQuerySchema, runAuditSchema, type RevenueQueryDto, type RunAuditDto } from './dto';
import type { AuthPrincipal } from '../auth/dto';

/** Night audit. Pro and above — it is the machinery behind a real day-end. */
@Controller('properties/:propertyId')
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard, TenantRoleGuard)
@Feature('night_audit')
export class NightAuditController {
  constructor(private readonly audit: NightAuditService) {}

  /** The property's business date, which is not necessarily today. */
  @Get('business-date')
  businessDate(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.audit.businessDate(tenantId, propertyId);
  }

  /** What the audit would do, without doing it. */
  @Get('night-audit/preview')
  preview(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.audit.preview(tenantId, propertyId);
  }

  /**
   * Run it. Records who and from where, because this is the most consequential button in the
   * product: it posts revenue, writes off no-shows, closes tills and moves the date. The owner's
   * alone (UX-1a) until a manager/night-auditor role exists (UX-6).
   */
  @Post('night-audit/run')
  @HttpCode(201)
  @TenantRoles('OWNER')
  run(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(runAuditSchema)) dto: RunAuditDto,
  ) {
    return this.audit.run(tenantId, propertyId, user.sub, ip ?? null, dto.keep ?? []);
  }

  @Get('night-audit/log')
  history(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.audit.history(tenantId, propertyId);
  }

  /** Room revenue actually posted over a period — what the payout must reconcile against. */
  @Get('night-audit/revenue')
  revenue(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Query(new ZodValidationPipe(revenueQuerySchema)) q: RevenueQueryDto,
  ) {
    return this.audit.revenue(tenantId, propertyId, q.from, q.to);
  }
}
