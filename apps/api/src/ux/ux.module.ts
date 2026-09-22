import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { UxController, UxStaffController } from './ux.controller';
import { UxService } from './ux.service';

/** UX measurement (UX Excellence Program, UX-0). See docs/UX-STANDARD.md. */
@Module({
  imports: [AuthModule],
  controllers: [UxController, UxStaffController],
  providers: [UxService, TenantGuard, RolesGuard],
})
export class UxModule {}
