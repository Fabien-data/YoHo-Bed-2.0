import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingModule } from '../billing/billing.module';
import { NightAuditService } from './nightaudit.service';
import { NightAuditController } from './nightaudit.controller';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [NightAuditController],
  providers: [NightAuditService, TenantGuard],
  exports: [NightAuditService],
})
export class NightAuditModule {}
