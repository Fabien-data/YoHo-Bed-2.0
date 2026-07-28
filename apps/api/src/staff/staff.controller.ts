import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StaffService } from './staff.service';
import {
  setTenantStatusSchema,
  rejectSchema,
  setPropertyCurrencySchema,
  type SetTenantStatusDto,
  type RejectDto,
  type SetPropertyCurrencyDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';

/** Cross-tenant staff console. Requires a YoHo staff role — replaces the legacy CI backend bridge. */
@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('YOHO_STAFF', 'YOHO_ADMIN')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('tenants')
  listTenants() {
    return this.staff.listTenants();
  }

  @Get('tenants/:id/bookings')
  tenantBookings(@Param('id') tenantId: string) {
    return this.staff.tenantBookings(tenantId);
  }

  @Post('tenants/:id/bookings/:bid/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') tenantId: string,
    @Param('bid') bookingId: string,
  ) {
    return this.staff.approveBooking(user, tenantId, bookingId);
  }

  @Post('tenants/:id/bookings/:bid/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') tenantId: string,
    @Param('bid') bookingId: string,
    @Body(new ZodValidationPipe(rejectSchema)) dto: RejectDto,
  ) {
    return this.staff.rejectBooking(user, tenantId, bookingId, dto.reason);
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') tenantId: string,
    @Body(new ZodValidationPipe(setTenantStatusSchema)) dto: SetTenantStatusDto,
  ) {
    return this.staff.setTenantStatus(user, tenantId, dto.status);
  }

  @Get('tenants/:id/properties')
  tenantProperties(@Param('id') tenantId: string) {
    return this.staff.listTenantProperties(tenantId);
  }

  @Post('tenants/:id/properties/:pid/currency')
  @HttpCode(200)
  setPropertyCurrency(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') tenantId: string,
    @Param('pid') propertyId: string,
    @Body(new ZodValidationPipe(setPropertyCurrencySchema)) dto: SetPropertyCurrencyDto,
  ) {
    return this.staff.setPropertyCurrency(user, tenantId, propertyId, dto.currency);
  }

  @Get('audit')
  audit() {
    return this.staff.recentAudit();
  }
}
