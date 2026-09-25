import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoomsService } from './rooms.service';
import { createRoomSchema, roomOrderSchema, type CreateRoomDto, type RoomOrderDto } from './dto';

/** Rooms nested under a property: /properties/:propertyId/rooms */
@Controller('properties/:propertyId/rooms')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class PropertyRoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.rooms.listByProperty(tenantId, propertyId);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createRoomSchema)) dto: CreateRoomDto,
  ) {
    return this.rooms.createRoom(tenantId, propertyId, dto);
  }

  /** The hotel's own order of its room types — the list's drag handles. */
  @Put('order')
  @TenantRoles('OWNER')
  order(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(roomOrderSchema)) dto: RoomOrderDto,
  ) {
    return this.rooms.reorderRooms(tenantId, propertyId, dto);
  }
}
