import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { DashboardService } from './dashboard.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(
    @TenantId() tenantId: string,
    @Query('date') date?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    if (!ISO_DATE.test(day)) throw new BadRequestException('date must be YYYY-MM-DD');
    return this.dashboard.overview(tenantId, day, propertyId || undefined);
  }
}
