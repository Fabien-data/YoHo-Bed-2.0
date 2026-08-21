import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BookingService } from './booking.service';
import { ReservationsService } from './reservations.service';
import { BookingsController } from './bookings.controller';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [AuthModule],
  controllers: [BookingsController, ReservationsController],
  providers: [BookingService, ReservationsService, TenantGuard],
  exports: [BookingService],
})
export class BookingsModule {}
