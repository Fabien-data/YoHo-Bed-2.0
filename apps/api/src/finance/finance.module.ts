import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, InvoicesController],
  providers: [FinanceService, InvoicesService, TenantGuard, TenantRoleGuard],
  exports: [InvoicesService],
})
export class FinanceModule {}
