import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

/** The private file store: payment slips and ID scans (Development Phase 02, Sprint 5). */
@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, TenantGuard],
  exports: [FilesService],
})
export class FilesModule {}
