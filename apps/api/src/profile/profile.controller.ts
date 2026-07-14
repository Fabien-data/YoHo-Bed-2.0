import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProfileService } from './profile.service';
import { payoutAccountSchema, type PayoutAccountDto } from './dto';
import type { AuthPrincipal } from '../auth/dto';

@Controller('profile')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal, @TenantId() tenantId: string) {
    return this.profile.get(user.sub, tenantId);
  }

  @Put('payout-account')
  setPayoutAccount(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(payoutAccountSchema)) dto: PayoutAccountDto,
  ) {
    return this.profile.setPayoutAccount(tenantId, dto);
  }

  @Post('agreement/accept')
  @HttpCode(200)
  acceptAgreement(@TenantId() tenantId: string) {
    return this.profile.acceptAgreement(tenantId);
  }
}
