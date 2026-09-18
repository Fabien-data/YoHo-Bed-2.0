import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { CurrentTenantRole, TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { ReservationService, type Actor } from './reservation.service';
import { ReservationLifecycleService } from './lifecycle.service';
import { RoomAvailabilityService } from './room-availability.service';
import { ContractRatesService } from './contract-rates.service';
import {
  confirmSchema,
  createReservationSchema,
  groupCancelSchema,
  holdSchema,
  quoteReservationSchema,
  releaseHoldSchema,
  roomAvailabilityQuerySchema,
  updateRatePlanSchema,
  type ConfirmDto,
  type CreateReservationDto,
  type GroupCancelDto,
  type HoldDto,
  type QuoteReservationDto,
  type ReleaseHoldDto,
  type RoomAvailabilityQuery,
  type UpdateRatePlanDto,
} from './dto';

const uuid = new ParseUUIDPipe();

/**
 * Taking and shaping reservations (Development Phase 02). Open to every plan: this is the front
 * desk's core job. Price authority is enforced inside the service, per the property's settings.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class ReservationEngineController {
  constructor(
    private readonly reservations: ReservationService,
    private readonly lifecycle: ReservationLifecycleService,
    private readonly availability: RoomAvailabilityService,
    private readonly contracts: ContractRatesService,
  ) {}

  /** The live Billing Summary: price a reservation without booking it. */
  @Post('reservations/quote')
  @HttpCode(200)
  quote(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Body(new ZodValidationPipe(quoteReservationSchema)) dto: QuoteReservationDto,
  ) {
    return this.reservations.quote(actorOf(tenantId, user, role), dto);
  }

  /**
   * Book it: every room of the reservation in one transaction. Send an `Idempotency-Key` header
   * and a retried request returns the first response instead of booking twice.
   */
  @Post('reservations')
  @HttpCode(201)
  async create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createReservationSchema)) dto: CreateReservationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = idempotencyKey?.trim().slice(0, 200) || undefined;
    const result = await this.reservations.create(actorOf(tenantId, user, role), dto, key);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  /** Rooms, rate types and free units for the reservation form's room grid. */
  @Get('properties/:id/room-availability')
  roomAvailability(
    @TenantId() tenantId: string,
    @Param('id', uuid) propertyId: string,
    @Query(new ZodValidationPipe(roomAvailabilityQuerySchema)) q: RoomAvailabilityQuery,
  ) {
    return this.availability.get(tenantId, propertyId, q);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  confirm(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(confirmSchema)) dto: ConfirmDto,
  ) {
    return this.lifecycle.confirm(actorOf(tenantId, user, role), id, dto);
  }

  @Post('bookings/:id/hold')
  @HttpCode(200)
  hold(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(holdSchema)) dto: HoldDto,
  ) {
    return this.lifecycle.hold(actorOf(tenantId, user, role), id, dto);
  }

  @Post('bookings/:id/release-hold')
  @HttpCode(200)
  releaseHold(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(releaseHoldSchema)) dto: ReleaseHoldDto,
  ) {
    return this.lifecycle.releaseHold(actorOf(tenantId, user, role), id, dto);
  }

  /** Confirm every room of a multi-room reservation (by its group id). */
  @Post('reservations/:groupId/confirm')
  @HttpCode(200)
  confirmGroup(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('groupId', uuid) groupId: string,
    @Body(new ZodValidationPipe(confirmSchema)) dto: ConfirmDto,
  ) {
    return this.lifecycle.confirmGroup(actorOf(tenantId, user, role), groupId, dto);
  }

  /** Cancel every room of a multi-room reservation that has not arrived. */
  @Post('reservations/:groupId/cancel')
  @HttpCode(200)
  cancelGroup(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('groupId', uuid) groupId: string,
    @Body(new ZodValidationPipe(groupCancelSchema)) dto: GroupCancelDto,
  ) {
    return this.lifecycle.cancelGroup(actorOf(tenantId, user, role), groupId, dto);
  }

  /** Who a rate plan is sold to (all / local / foreign), and its default market segment. */
  @Patch('rate-plans/:id')
  @TenantRoles('OWNER')
  updateRatePlan(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateRatePlanSchema)) dto: UpdateRatePlanDto,
  ) {
    return this.contracts.updateRatePlan(tenantId, id, dto);
  }
}

function actorOf(tenantId: string, user: AuthPrincipal, role: string | undefined): Actor {
  return { tenantId, userId: user.sub, role };
}
