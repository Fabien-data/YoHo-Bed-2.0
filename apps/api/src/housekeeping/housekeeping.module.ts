import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingModule } from '../billing/billing.module';
import { HousekeepingService } from './housekeeping.service';
import { HousekeepingController } from './housekeeping.controller';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService, TenantGuard],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
