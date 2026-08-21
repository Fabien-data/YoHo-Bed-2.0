import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { EntitlementGuard } from '../common/entitlement.guard';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';

/**
 * Exports BillingService and EntitlementGuard so any feature module can gate its routes with
 * `@Feature(...)` by importing this module.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService, RolesGuard, EntitlementGuard],
  exports: [BillingService, EntitlementGuard],
})
export class BillingModule {}
