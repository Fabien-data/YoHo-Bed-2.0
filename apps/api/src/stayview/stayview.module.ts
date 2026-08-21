import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { StayViewService } from './stayview.service';
import { BlocksService } from './blocks.service';
import { StayViewController } from './stayview.controller';

@Module({
  imports: [AuthModule],
  controllers: [StayViewController],
  providers: [StayViewService, BlocksService, TenantGuard],
})
export class StayViewModule {}
