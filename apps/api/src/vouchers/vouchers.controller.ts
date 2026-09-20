import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MailerService } from '../email/mailer.service';
import type { AuthPrincipal } from '../auth/dto';
import { VouchersService } from './vouchers.service';

const uuid = new ParseUUIDPipe();

export const sendVoucherSchema = z.object({
  emails: z.array(z.string().trim().email().max(200)).min(1).max(10),
});
type SendVoucherDto = z.infer<typeof sendVoucherSchema>;

/** The desk's side: preview and send the voucher, make or revoke the guest's link. */
@Controller('reservations/:id/voucher')
@UseGuards(JwtAuthGuard, TenantGuard)
export class VouchersController {
  constructor(
    private readonly vouchers: VouchersService,
    private readonly mailer: MailerService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  preview(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.vouchers.preview(tenantId, id);
  }

  @Post('send')
  @HttpCode(201)
  async send(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(sendVoucherSchema)) dto: SendVoucherDto,
  ) {
    const result = await this.vouchers.send(tenantId, id, dto.emails);
    this.mailer.deliverQueuedSafe(tenantId); // after commit
    return result;
  }

  @Post('link')
  @HttpCode(201)
  link(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
  ) {
    return this.vouchers.link(tenantId, id, user.sub);
  }

  @Delete('link')
  revoke(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.vouchers.revoke(tenantId, id);
  }
}

/** The guest's side: no login; the token is the key. Never indexed, never cached. */
@Controller('public/vouchers')
export class PublicVouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get(':token')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  view(@Param('token') token: string) {
    return this.vouchers.publicView(token);
  }
}
