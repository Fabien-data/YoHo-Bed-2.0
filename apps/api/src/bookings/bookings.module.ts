import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BookingService } from './booking.service';
import { BookingsController } from './bookings.controller';

@Module({
  imports: [AuthModule],
  controllers: [BookingsController],
  providers: [BookingService, TenantGuard],
  exports: [BookingService],
})
export class BookingsModule {}
