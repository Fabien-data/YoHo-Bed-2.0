import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CommsService } from './comms.service';
import { updateTemplateSchema, type UpdateTemplateDto } from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
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

  @Patch('templates/:id')
  updateTemplate(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateDto,
  ) {
    return this.comms.updateTemplate(tenantId, id, dto);
  }

  @Get('languages')
  listLanguages() {
    return this.comms.listLanguages();
  }
}
