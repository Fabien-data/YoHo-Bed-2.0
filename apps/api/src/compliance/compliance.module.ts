import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [AuthModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, TenantGuard],
  exports: [ComplianceService],
})
export class ComplianceModule {}
