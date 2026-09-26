import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CommsService } from './comms.service';
import {
  createTemplateSchema,
  updateTemplateSchema,
  type CreateTemplateDto,
  type UpdateTemplateDto,
} from './dto';

const uuid = new ParseUUIDPipe();

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class CommsController {
  constructor(private readonly comms: CommsService) {}

  @Get('notifications')
  listNotifications(@TenantId() tenantId: string) {
    return this.comms.listNotifications(tenantId);
  }

  @Get('notifications/unread-count')
  unreadCount(@TenantId() tenantId: string) {
    return this.comms.unreadCount(tenantId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  markAllRead(@TenantId() tenantId: string) {
    return this.comms.markAllRead(tenantId);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  markRead(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.comms.markRead(tenantId, id);
  }

  @Get('messages')
  listMessages(@TenantId() tenantId: string) {
    return this.comms.listMessages(tenantId);
  }

  /** Re-queue a failed (or stranded) message and try delivery again immediately. */
  @Post('messages/:id/retry')
  @HttpCode(200)
  retryMessage(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.comms.retryMessage(tenantId, id);
  }

  @Get('templates')
  listTemplates(@TenantId() tenantId: string) {
    return this.comms.listTemplates(tenantId);
  }

  /** What guests read is the owner's to word (Configuration → Email templates, 2026-09-26). */
  @Patch('templates/:id')
  @TenantRoles('OWNER')
  updateTemplate(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateDto,
  ) {
    return this.comms.updateTemplate(tenantId, id, dto);
  }

  @Post('templates')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createTemplate(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateDto,
  ) {
    return this.comms.createTemplate(tenantId, dto);
  }

  @Delete('templates/:id')
  @TenantRoles('OWNER')
  deleteTemplate(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.comms.deleteTemplate(tenantId, id);
  }

  @Post('templates/:id/reset')
  @HttpCode(200)
  @TenantRoles('OWNER')
  resetTemplate(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.comms.resetTemplate(tenantId, id);
  }

  @Get('languages')
  listLanguages() {
    return this.comms.listLanguages();
  }
}
