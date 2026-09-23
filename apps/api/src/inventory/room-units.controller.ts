import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import type { AuthPrincipal } from '../auth/dto';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { bulkSchema as bulkAssignSchema } from '../bookings/dto';
import { RoomUnitsService } from './room-units.service';
import {
  assignRoomsSchema,
  createRoomUnitSchema,
  exchangeRoomsSchema,
  moveRoomSchema,
  updateRoomUnitSchema,
  type AssignRoomsDto,
  type CreateRoomUnitDto,
  type ExchangeRoomsDto,
  type MoveRoomDto,
  type UpdateRoomUnitDto,
} from './dto';

/** Physical rooms of a property: /properties/:propertyId/room-units */
@Controller('properties/:propertyId/room-units')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PropertyRoomUnitsController {
  constructor(private readonly units: RoomUnitsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.units.listByProperty(tenantId, propertyId);
  }

  /** Physical rooms vs the sellable bucket, per room type — a setup health check. */
  @Get('counts')
  counts(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.units.countsByRoom(tenantId, propertyId);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createRoomUnitSchema)) dto: CreateRoomUnitDto,
  ) {
    return this.units.create(tenantId, propertyId, dto);
  }
}

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class RoomUnitsController {
  constructor(private readonly units: RoomUnitsService) {}

  @Patch('room-units/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoomUnitSchema)) dto: UpdateRoomUnitDto,
  ) {
    return this.units.update(tenantId, id, dto);
  }

  /** The booking's legs — one per physical room — and which unit each holds. */
  @Get('bookings/:id/rooms')
  legs(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.units.listLegs(tenantId, id);
  }

  @Post('bookings/:id/assign')
  @HttpCode(200)
  assign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignRoomsSchema)) dto: AssignRoomsDto,
  ) {
    return this.units.assign(tenantId, id, dto);
  }

  /** Fill every unassigned leg with the lowest-numbered free room. Partial success is reported. */
  /** Give rooms to a selection of stays at once (UX-2). */
  @Post('bookings/bulk/assign-rooms')
  @HttpCode(200)
  bulkAssign(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(bulkAssignSchema)) dto: { ids: string[] },
  ) {
    return this.units.bulkAutoAssign(tenantId, dto.ids);
  }

  @Post('bookings/:id/auto-assign')
  @HttpCode(200)
  autoAssign(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.units.autoAssign(tenantId, id);
  }

  @Get('bookings/:id/room-moves')
  moves(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.units.listMoves(tenantId, id);
  }

  @Post('bookings/:id/room-move')
  @HttpCode(200)
  @TenantRoles('OWNER', 'OWNER_STAFF', 'HOUSEKEEPING_SUPERVISOR')
  move(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveRoomSchema)) dto: MoveRoomDto,
  ) {
    return this.units.move(tenantId, id, user.sub, dto);
  }

  @Post('room-moves/exchange')
  @HttpCode(200)
  @TenantRoles('OWNER', 'OWNER_STAFF')
  exchange(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(exchangeRoomsSchema)) dto: ExchangeRoomsDto,
  ) {
    return this.units.exchange(tenantId, user.sub, dto);
  }

  @Post('room-moves/:id/stop')
  @HttpCode(200)
  @TenantRoles('OWNER', 'OWNER_STAFF', 'HOUSEKEEPING_SUPERVISOR')
  stopMove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.units.stopMove(tenantId, id);
  }
}
