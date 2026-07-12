import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DistributionService } from './distribution.service';
import { DistributionController } from './distribution.controller';

@Module({
  imports: [AuthModule],
  controllers: [DistributionController],
  providers: [DistributionService, TenantGuard],
})
export class DistributionModule {}
