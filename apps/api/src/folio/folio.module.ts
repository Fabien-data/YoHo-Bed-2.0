import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingModule } from '../billing/billing.module';
import { FolioService } from './folio.service';
import { FolioController } from './folio.controller';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [FolioController],
  providers: [FolioService, TenantGuard],
  exports: [FolioService],
})
export class FolioModule {}
