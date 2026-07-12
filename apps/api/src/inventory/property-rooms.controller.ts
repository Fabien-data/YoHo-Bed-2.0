import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoomsService } from './rooms.service';
import { createRoomSchema, type CreateRoomDto } from './dto';

/** Rooms nested under a property: /properties/:propertyId/rooms */
@Controller('properties/:propertyId/rooms')
@UseGuards(JwtAuthGuard, TenantGuard)
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
}
