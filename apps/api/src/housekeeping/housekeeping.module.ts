import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingModule } from '../billing/billing.module';
import { StayViewModule } from '../stayview/stayview.module';
import { HousekeepingService } from './housekeeping.service';
import { HousekeepingController } from './housekeeping.controller';
import { TenantRoleGuard } from '../common/tenant-role';

@Module({
  imports: [AuthModule, BillingModule, StayViewModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService, TenantGuard, TenantRoleGuard],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
