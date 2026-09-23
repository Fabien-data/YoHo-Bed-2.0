import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { TaxesService } from './taxes.service';

const uuid = new ParseUUIDPipe();

/** Setup → Taxes & levies (Development Phase 02, Sprint 7). Reading is open; changing is the owner's. */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get('properties/:id/taxes')
  overview(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.taxes.overview(tenantId, id);
  }

  @Post('properties/:id/taxes/apply-preset')
  @HttpCode(200)
  @TenantRoles('OWNER')
  applyPreset(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.taxes.applyPreset(tenantId, id);
  }
}
