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
import { rooms } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InventoryService } from './inventory.service';
import { RoomsService } from './rooms.service';
import {
  reserveSchema,
  updateRoomSchema,
  openAvailabilitySchema,
  type ReserveDto,
  type UpdateRoomDto,
  type OpenAvailabilityDto,
} from './dto';

@Controller('rooms')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RoomsController {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly inventory: InventoryService,
    private readonly roomsService: RoomsService,
  ) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) => tx.select().from(rooms));
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoomSchema)) dto: UpdateRoomDto,
  ) {
    return this.roomsService.updateRoom(tenantId, id, dto);
  }

  @Post(':id/availability')
  @HttpCode(200)
  openAvailability(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Body(new ZodValidationPipe(openAvailabilitySchema)) dto: OpenAvailabilityDto,
  ) {
    return this.roomsService.openAvailability(tenantId, roomId, dto);
  }

  @Get(':id/availability')
  availability(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.inventory.getAvailability(tenantId, roomId, from, to);
  }

  @Post(':id/reserve')
  @HttpCode(200)
  reserve(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Body(new ZodValidationPipe(reserveSchema)) dto: ReserveDto,
  ) {
    return this.inventory.reserve(tenantId, roomId, dto.checkin, dto.checkout, dto.rooms);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Body(new ZodValidationPipe(reserveSchema)) dto: ReserveDto,
  ) {
    return this.inventory.release(tenantId, roomId, dto.checkin, dto.checkout, dto.rooms);
  }
}
