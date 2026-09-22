import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { timer, map, merge, filter, type Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { CurrentTenantRole, TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { HousekeepingService } from './housekeeping.service';
import {
  createWorkOrderSchema,
  houseStatusQuerySchema,
  setHousekeepingSchema,
  updateWorkOrderSchema,
  floorLayoutSchema,
  taskQuerySchema,
  updateTaskSchema,
  roomSignalsSchema,
  type CreateWorkOrderDto,
  type HouseStatusQueryDto,
  type SetHousekeepingDto,
  type UpdateWorkOrderDto,
  type FloorLayoutDto,
  type UpdateTaskDto,
  type RoomSignalsDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';

/**
 * Room View, House Status and Work Orders.
 *
 * Housekeeping itself is in every plan — even a one-property Starter hotel has to clean rooms.
 * Work orders are Pro and above, so those three routes carry their own `@Feature`; method-level
 * metadata overrides the class-level default in `EntitlementGuard`.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard, TenantRoleGuard)
@Feature('housekeeping')
export class HousekeepingController {
  constructor(private readonly hk: HousekeepingService) {}

  /** The Room View card grid — also the House Status grid, same data rendered two ways. */
  // `room_view` is its own plan key and the nav gates the screen on it — not on housekeeping.
  @Feature('room_view')
  @Get('room-view')
  async roomView(
    @TenantId() tenantId: string,
    @CurrentTenantRole() role: string | undefined,
    @Query(new ZodValidationPipe(houseStatusQuerySchema)) q: HouseStatusQueryDto,
  ) {
    const date = q.date ?? (await this.hk.todayFor(tenantId, q.propertyId));
    const cards = await this.hk.roomCards(
      tenantId,
      q.propertyId,
      date,
      role === 'OWNER' || role === 'OWNER_STAFF',
    );
    if (role === 'HOUSEKEEPING_ATTENDANT' || role === 'HOUSEKEEPING_SUPERVISOR') {
      return cards.map((card) => ({
        ...card,
        guestEmail: null,
        bookingId: null,
        legId: null,
        reference: null,
        balanceDue: false,
        source: null,
      }));
    }
    return cards;
  }

  /** Authenticated refresh stream. Clients reconnect automatically and retain polling as backup. */
  @Feature('room_view')
  @Sse('room-updates')
  roomUpdates(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema)) q: HouseStatusQueryDto,
  ): Observable<MessageEvent> {
    const heartbeat = timer(0, 3_000).pipe(map((sequence) => ({ sequence, source: 'poll' })));
    const changes = this.hk.updates.pipe(
      filter(
        (event) =>
          event.tenantId === tenantId &&
          event.propertyId === q.propertyId &&
          (!event.date || !q.date || event.date === q.date),
      ),
      map(() => ({ sequence: null, source: 'change' })),
    );
    return merge(heartbeat, changes).pipe(
      map(({ sequence, source }) => ({
        type: 'room-update',
        data: {
          tenantId,
          propertyId: q.propertyId,
          date: q.date ?? null,
          sequence,
          source,
          at: new Date().toISOString(),
        },
      })),
    );
  }

  @Get('house-status/summary')
  async summary(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema)) q: HouseStatusQueryDto,
  ) {
    const date = q.date ?? (await this.hk.todayFor(tenantId, q.propertyId));
    return this.hk.summary(tenantId, q.propertyId, date);
  }

  @Post('properties/:propertyId/housekeeping')
  @HttpCode(200)
  setStatus(
    @TenantId() tenantId: string,
    @CurrentTenantRole() role: string | undefined,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(setHousekeepingSchema)) dto: SetHousekeepingDto,
  ) {
    if (dto.status === 'inspected' && role !== 'OWNER' && role !== 'HOUSEKEEPING_SUPERVISOR') {
      throw new ForbiddenException('Only a housekeeping supervisor can inspect rooms');
    }
    if (role === 'HOUSEKEEPING_ATTENDANT' && dto.status !== 'clean') {
      throw new ForbiddenException('Attendants can only submit rooms as clean');
    }
    return this.hk.setStatus(tenantId, propertyId, user.sub, dto, role);
  }

  @Get('properties/:propertyId/floor-layouts')
  @Feature('room_view')
  listFloorLayouts(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.hk.listFloorLayouts(tenantId, propertyId);
  }

  @Put('properties/:propertyId/floor-layouts')
  @Feature('room_view')
  @TenantRoles('OWNER', 'HOUSEKEEPING_SUPERVISOR')
  saveFloorLayout(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(floorLayoutSchema)) dto: FloorLayoutDto,
  ) {
    return this.hk.saveFloorLayout(tenantId, propertyId, dto);
  }

  @Get('properties/:propertyId/housekeeping/tasks')
  listTasks(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @CurrentTenantRole() role: string | undefined,
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(taskQuerySchema)) q: { date: string },
  ) {
    return this.hk.listTasks(tenantId, propertyId, q.date, role ?? '', user.sub);
  }

  @Patch('housekeeping/tasks/:id')
  @TenantRoles('OWNER', 'HOUSEKEEPING_SUPERVISOR', 'HOUSEKEEPING_ATTENDANT')
  updateTask(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentTenantRole() role: string | undefined,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(updateTaskSchema)) dto: UpdateTaskDto,
  ) {
    return this.hk.updateTask(tenantId, id, dto, role ?? '', user.sub);
  }

  @Patch('bookings/:id/room-signals')
  @TenantRoles('OWNER', 'OWNER_STAFF')
  updateSignals(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(roomSignalsSchema)) dto: RoomSignalsDto,
  ) {
    return this.hk.updateSignals(tenantId, id, dto, user.sub);
  }

  /** The morning sweep: every room a guest left today becomes dirty. */
  @Post('properties/:propertyId/housekeeping/mark-departures-dirty')
  @HttpCode(200)
  @TenantRoles('OWNER', 'OWNER_STAFF', 'HOUSEKEEPING_SUPERVISOR')
  async markDepartures(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Query(new ZodValidationPipe(houseStatusQuerySchema.pick({ date: true }))) q: { date?: string },
  ) {
    const date = q.date ?? (await this.hk.todayFor(tenantId, propertyId));
    return this.hk.markDeparturesDirty(tenantId, propertyId, date, user.sub);
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
