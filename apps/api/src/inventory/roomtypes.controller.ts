import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoomsService } from './rooms.service';
import { roomtypeSchema, type RoomtypeDto } from './dto';

@Controller('roomtypes')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RoomtypesController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.rooms.listRoomtypes(tenantId);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(roomtypeSchema)) dto: RoomtypeDto,
  ) {
    return this.rooms.createRoomtype(tenantId, dto);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roomtypeSchema)) dto: RoomtypeDto,
  ) {
    return this.rooms.updateRoomtype(tenantId, id, dto);
  }
}
