import { Module } from '@nestjs/common';
import { ReservationPricer } from './pricer';

/**
 * The pricer on its own, so the bookings module (walk-in create, amend) and the reservations
 * module (quote, create) share one instance without importing each other.
 */
@Module({
  providers: [ReservationPricer],
  exports: [ReservationPricer],
})
export class ReservationPricingModule {}
