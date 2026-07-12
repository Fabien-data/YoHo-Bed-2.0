import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RolesGuard } from '../common/roles.guard';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';

@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [StaffController],
  providers: [StaffService, RolesGuard],
})
export class StaffModule {}
