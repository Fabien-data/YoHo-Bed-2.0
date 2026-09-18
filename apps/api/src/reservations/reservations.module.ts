import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { BookingsModule } from '../bookings/bookings.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { ReservationPricingModule } from './pricing.module';
import { ReservationService } from './reservation.service';
import { ReservationLifecycleService } from './lifecycle.service';
import { RoomAvailabilityService } from './room-availability.service';
import { ContractRatesService } from './contract-rates.service';
import { ReservationEngineController } from './reservation-engine.controller';
import { ContractRatesController } from './contract-rates.controller';
import { BookingExtrasService } from './booking-extras.service';
import { BookingExtrasController } from './booking-extras.controller';
import { StayServicesService } from './stay-services.service';

/** The reservation engine (Development Phase 02, Sprint 2). */
@Module({
  imports: [AuthModule, BillingModule, BookingsModule, ReservationPricingModule],
  controllers: [ReservationEngineController, ContractRatesController, BookingExtrasController],
  providers: [
    ReservationService,
    ReservationLifecycleService,
    RoomAvailabilityService,
    ContractRatesService,
    BookingExtrasService,
    StayServicesService,
    TenantGuard,
    TenantRoleGuard,
  ],
})
export class ReservationsModule {}
