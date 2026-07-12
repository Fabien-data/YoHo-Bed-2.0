import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { InventoryService } from './inventory.service';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { PropertyRoomsController } from './property-rooms.controller';
import { RoomtypesController } from './roomtypes.controller';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController, PropertyRoomsController, RoomtypesController],
  providers: [InventoryService, RoomsService, TenantGuard],
})
export class InventoryModule {}
