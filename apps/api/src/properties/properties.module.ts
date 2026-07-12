import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PropertiesController } from './properties.controller';
import { PropertyService } from './property.service';

@Module({
  imports: [AuthModule],
  controllers: [PropertiesController],
  providers: [PropertyService, TenantGuard],
})
export class PropertiesModule {}
