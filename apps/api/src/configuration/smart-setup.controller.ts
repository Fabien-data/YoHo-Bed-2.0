import { Body, Controller, Get, Param, Put, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthPrincipal } from '../auth/dto';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SmartSetupService } from './smart-setup.service';
import {
  saveSmartDraftSchema,
  smartPreviewSchema,
  publishSmartSchema,
  type SaveSmartDraftDto,
  type SmartPreviewDto,
  type PublishSmartDto,
} from './smart-setup.dto';

@Controller('properties/:id/smart-setup')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
@TenantRoles('OWNER')
export class SmartSetupController {
  constructor(private readonly service: SmartSetupService) {}
  @Get()
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.configuration(tenantId, id);
  }
  @Put('draft')
  save(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(saveSmartDraftSchema)) dto: SaveSmartDraftDto,
  ) {
    return this.service.save(tenantId, id, user.sub, dto);
  }
  @Post('preview')
  preview(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(smartPreviewSchema)) dto: SmartPreviewDto,
  ) {
    return this.service.preview(tenantId, id, dto);
  }
  @Post('publish')
  publish(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(publishSmartSchema)) dto: PublishSmartDto,
  ) {
    return this.service.publish(tenantId, id, user.sub, dto);
  }
}
