import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CommercialService } from './commercial.service';
import { CommercialController } from './commercial.controller';

@Module({
  imports: [AuthModule],
  controllers: [CommercialController],
  providers: [CommercialService, TenantGuard],
})
export class CommercialModule {}
