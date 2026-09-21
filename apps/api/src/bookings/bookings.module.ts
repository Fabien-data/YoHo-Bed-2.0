import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { BookingService } from './booking.service';
import { ReservationsService } from './reservations.service';
import { BookingsController } from './bookings.controller';
import { ReservationsController } from './reservations.controller';
import { ReservationPricingModule } from '../reservations/pricing.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, ReservationPricingModule, BillingModule],
  controllers: [BookingsController, ReservationsController],
  providers: [BookingService, ReservationsService, TenantGuard, TenantRoleGuard],
  exports: [BookingService],
})
export class BookingsModule {}
