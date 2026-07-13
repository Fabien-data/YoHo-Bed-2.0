import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BookingsModule } from '../bookings/bookings.module';
import { OtaController } from './ota.controller';
import { OtaService } from './ota.service';
import { CmSecretGuard } from './cm-secret.guard';

@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [OtaController],
  providers: [OtaService, TenantGuard, CmSecretGuard],
})
export class OtaModule {}
