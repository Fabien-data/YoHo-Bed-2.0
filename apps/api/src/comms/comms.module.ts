import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CommsService } from './comms.service';
import { CommsController } from './comms.controller';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [CommsController],
  providers: [CommsService, TenantGuard],
})
export class CommsModule {}
