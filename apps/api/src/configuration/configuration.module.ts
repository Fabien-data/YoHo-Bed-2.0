import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard } from '../common/tenant-role';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { MastersService } from './masters.service';
import { SmartSetupController } from './smart-setup.controller';
import { SmartSetupService } from './smart-setup.service';
import { HotelRolesController } from './hotel-roles.controller';
import { HotelRolesService } from './hotel-roles.service';
import { HotelAccessController } from './hotel-access.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    ConfigurationController,
    SmartSetupController,
    HotelRolesController,
    HotelAccessController,
  ],
  providers: [
    ConfigurationService,
    MastersService,
    SmartSetupService,
    HotelRolesService,
    TenantGuard,
    TenantRoleGuard,
  ],
  exports: [ConfigurationService, MastersService],
})
export class ConfigurationModule {}
