import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { MastersService } from './masters.service';

@Module({
  imports: [AuthModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, MastersService, TenantGuard, TenantRoleGuard],
  exports: [ConfigurationService, MastersService],
})
export class ConfigurationModule {}
