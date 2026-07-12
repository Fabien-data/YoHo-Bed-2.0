import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [FinanceService, TenantGuard],
})
export class FinanceModule {}
