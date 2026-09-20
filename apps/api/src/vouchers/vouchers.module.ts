import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PublicVouchersController, VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [VouchersController, PublicVouchersController],
  providers: [VouchersService, TenantGuard],
})
export class VouchersModule {}
