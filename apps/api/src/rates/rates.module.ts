import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';

@Module({
  imports: [AuthModule],
  controllers: [RatesController],
  providers: [RatesService, TenantGuard],
})
export class RatesModule {}
