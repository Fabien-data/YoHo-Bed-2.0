import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { CurrentUser } from '../tenancy/decorators';
import type { AuthPrincipal } from '../auth/dto';
import {
  CurrentTenantRole,
  TenantRoleGuard,
  TenantRoles,
  type TenantRole,
} from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingService, type TransitionContext } from './booking.service';
import {
  amendBookingSchema,
  cancelSchema,
  checkInSchema,
  checkOutSchema,
  createBookingSchema,
  reasonRequiredSchema,
  rejectSchema,
  type AmendBookingDto,
  type CancelDto,
  type CheckInDto,
  type CheckOutDto,
  type CreateBookingDto,
  type ReasonRequiredDto,
  type RejectDto,
} from './dto';

/** Who is acting and from where: every lifecycle action is on the record (UX-1a). */
function actor(user: AuthPrincipal, role: TenantRole | undefined, ip: string): TransitionContext {
  return { actorUserId: user.sub, role, ip: ip || null };
}

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
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
  ) {
    return this.bookings.approve(tenantId, id, actor(user, role, ip));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) dto: RejectDto,
  ) {
    return this.bookings.reject(tenantId, id, dto.reason, actor(user, role, ip));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) dto: CancelDto,
  ) {
    return this.bookings.cancel(tenantId, id, dto.reason, actor(user, role, ip));
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
  ) {
    return this.bookings.noShow(tenantId, id, actor(user, role, ip));
  }

  /**
   * Check in. Refused (409 with a `reason` and a sentence saying what to do) before the arrival
   * day, without a free room, into a room that is blocked or out of order, into a dirty room
   * unless `overrideDirty` with a reason, or without an ID when the hotel requires one.
   */
  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkInSchema)) dto: CheckInDto,
  ) {
    return this.bookings.checkIn(tenantId, id, dto.reason, {
      ...actor(user, role, ip),
      overrideDirty: dto.overrideDirty,
    });
  }

  /**
   * Check out. With the property's default policy, a guest balance left unpaid is refused
   * (409 `balance_open`) unless the owner sends `allowBalance` with a reason.
   */
  @Post(':id/check-out')
  @HttpCode(200)
  checkOut(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkOutSchema)) dto: CheckOutDto,
  ) {
    return this.bookings.checkOut(tenantId, id, dto.reason, {
      ...actor(user, role, ip),
      allowBalance: dto.allowBalance,
    });
  }

  @Post(':id/undo-check-in')
  @HttpCode(200)
  undoCheckIn(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonRequiredSchema)) dto: ReasonRequiredDto,
  ) {
    return this.bookings.undoCheckIn(tenantId, id, dto.reason, actor(user, role, ip));
  }

  @Post(':id/undo-check-out')
  @HttpCode(200)
  undoCheckOut(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonRequiredSchema)) dto: ReasonRequiredDto,
  ) {
    return this.bookings.undoCheckOut(tenantId, id, dto.reason, actor(user, role, ip));
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  reinstate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonRequiredSchema)) dto: ReasonRequiredDto,
  ) {
    return this.bookings.reinstate(tenantId, id, dto.reason, actor(user, role, ip));
  }

  @Post(':id/void')
  @HttpCode(200)
  @TenantRoles('OWNER')
  void(@TenantId() tenantId: string, @CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
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
