import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';

@Module({
  imports: [AuthModule],
  controllers: [FxController],
  providers: [FxService, RolesGuard],
})
export class FxModule {}
