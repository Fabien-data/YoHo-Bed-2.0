import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoomUnitsService } from './room-units.service';
import {
  assignRoomsSchema,
  createRoomUnitSchema,
  updateRoomUnitSchema,
  type AssignRoomsDto,
  type CreateRoomUnitDto,
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
@UseGuards(JwtAuthGuard, TenantGuard)
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
  @Post('bookings/:id/auto-assign')
  @HttpCode(200)
  autoAssign(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.units.autoAssign(tenantId, id);
  }
}
