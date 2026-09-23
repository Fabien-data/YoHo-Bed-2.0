import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';

@Module({
  imports: [AuthModule],
  controllers: [RatesController, TaxesController],
  providers: [RatesService, TaxesService, TenantGuard, TenantRoleGuard],
  exports: [RatesService],
})
export class RatesModule {}
