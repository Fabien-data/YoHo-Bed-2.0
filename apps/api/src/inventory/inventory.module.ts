import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { InventoryService } from './inventory.service';
import { RoomsService } from './rooms.service';
import { RoomUnitsService } from './room-units.service';
import { RoomsController } from './rooms.controller';
import { PropertyRoomsController } from './property-rooms.controller';
import { RoomtypesController } from './roomtypes.controller';
import { PropertyRoomUnitsController, RoomUnitsController } from './room-units.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    RoomsController,
    PropertyRoomsController,
    RoomtypesController,
    PropertyRoomUnitsController,
    RoomUnitsController,
  ],
  providers: [InventoryService, RoomsService, RoomUnitsService, TenantGuard, TenantRoleGuard],
  exports: [RoomUnitsService],
})
export class InventoryModule {}
