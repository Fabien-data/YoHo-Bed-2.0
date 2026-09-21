import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { CurrentUser } from '../tenancy/decorators';
import type { AuthPrincipal } from '../auth/dto';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingService } from './booking.service';
import {
  amendBookingSchema,
  createBookingSchema,
  rejectSchema,
  type AmendBookingDto,
  type CreateBookingDto,
  type RejectDto,
} from './dto';

@Controller('bookings')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.bookings.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.get(tenantId, id);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createBookingSchema)) dto: CreateBookingDto,
  ) {
    return this.bookings.createWalkIn(tenantId, dto);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.approve(tenantId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) dto: RejectDto,
  ) {
    return this.bookings.reject(tenantId, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.cancel(tenantId, id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.noShow(tenantId, id);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.checkIn(tenantId, id);
  }

  @Post(':id/check-out')
  @HttpCode(200)
  checkOut(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.checkOut(tenantId, id);
  }

  @Post(':id/void')
  @HttpCode(200)
  @TenantRoles('OWNER')
  void(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.bookings.void(tenantId, id, user.sub);
  }

  @Patch(':id')
  amend(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(amendBookingSchema)) dto: AmendBookingDto,
  ) {
    return this.bookings.amend(tenantId, id, dto);
  }
}
