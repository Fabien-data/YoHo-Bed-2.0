import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingService } from './booking.service';
import { createBookingSchema, rejectSchema, type CreateBookingDto, type RejectDto } from './dto';

@Controller('bookings')
@UseGuards(JwtAuthGuard, TenantGuard)
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
}
