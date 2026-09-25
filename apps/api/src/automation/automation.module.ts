import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BookingsModule } from '../bookings/bookings.module';
import { NightAuditModule } from '../nightaudit/nightaudit.module';
import { DayCloseService } from './day-close.service';

/** Work the hotel's day does by itself: automatic check-out and the automatic night audit. */
@Module({
  imports: [BillingModule, BookingsModule, NightAuditModule],
  providers: [DayCloseService],
  exports: [DayCloseService],
})
export class AutomationModule {}
