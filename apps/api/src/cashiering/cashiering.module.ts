import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingModule } from '../billing/billing.module';
import { CashieringService } from './cashiering.service';
import { CashieringController } from './cashiering.controller';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [CashieringController],
  providers: [CashieringService, TenantGuard],
  exports: [CashieringService],
})
export class CashieringModule {}
