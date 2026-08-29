import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { HousekeepingService } from './housekeeping.service';
import {
  createWorkOrderSchema,
  houseStatusQuerySchema,
  setHousekeepingSchema,
  updateWorkOrderSchema,
  type CreateWorkOrderDto,
  type HouseStatusQueryDto,
  type SetHousekeepingDto,
  type UpdateWorkOrderDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Room View, House Status and Work Orders.
 *
 * Housekeeping itself is in every plan — even a one-property Starter hotel has to clean rooms.
 * Work orders are Pro and above, so those three routes carry their own `@Feature`; method-level
 * metadata overrides the class-level default in `EntitlementGuard`.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard)
@Feature('housekeeping')
export class HousekeepingController {
  constructor(private readonly hk: HousekeepingService) {}

  /** The Room View card grid — also the House Status grid, same data rendered two ways. */
  // `room_view` is its own plan key and the nav gates the screen on it — not on housekeeping.
  @Feature('room_view')
  @Get('room-view')
  roomView(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema)) q: HouseStatusQueryDto,
  ) {
    return this.hk.roomCards(tenantId, q.propertyId, q.date ?? today());
  }

  @Get('house-status/summary')
  summary(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema)) q: HouseStatusQueryDto,
  ) {
    return this.hk.summary(tenantId, q.propertyId, q.date ?? today());
  }

  @Post('properties/:propertyId/housekeeping')
  @HttpCode(200)
  setStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(setHousekeepingSchema)) dto: SetHousekeepingDto,
  ) {
    return this.hk.setStatus(tenantId, propertyId, user.sub, dto);
  }

  /** The morning sweep: every room a guest left today becomes dirty. */
  @Post('properties/:propertyId/housekeeping/mark-departures-dirty')
  @HttpCode(200)
  markDepartures(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema.pick({ date: true }))) q: { date?: string },
  ) {
    return this.hk.markDeparturesDirty(tenantId, propertyId, q.date ?? today(), user.sub);
  }

  @Get('properties/:propertyId/work-orders')
  @Feature('work_orders')
  listWorkOrders(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.hk.listWorkOrders(tenantId, propertyId);
  }

  @Post('properties/:propertyId/work-orders')
  @HttpCode(201)
  @Feature('work_orders')
  createWorkOrder(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createWorkOrderSchema)) dto: CreateWorkOrderDto,
  ) {
    return this.hk.createWorkOrder(tenantId, propertyId, user.sub, dto);
  }

  @Patch('work-orders/:id')
  @Feature('work_orders')
  updateWorkOrder(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkOrderSchema)) dto: UpdateWorkOrderDto,
  ) {
    return this.hk.updateWorkOrder(tenantId, id, dto);
  }
}
