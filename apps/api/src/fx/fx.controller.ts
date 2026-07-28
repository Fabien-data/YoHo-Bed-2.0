import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FxService } from './fx.service';
import { fxOverrideSchema, type FxOverrideDto } from './dto';
import type { AuthPrincipal } from '../auth/dto';

/**
 * Exchange rates. Reads are open to any authenticated user (rates are global, not tenant-scoped) so
 * owners can pick a display currency. The manual override is YoHo-staff only.
 */
@Controller('fx')
@UseGuards(JwtAuthGuard)
export class FxController {
  constructor(private readonly fx: FxService) {}

  /** Current "1 base = N LKR" table (including LKR = 1) for the display-currency picker. */
  @Get('rates')
  current() {
    return this.fx.current();
  }

  @Get('history')
  history(@Query('base') base?: string, @Query('limit') limit?: string) {
    return this.fx.history(base, limit ? Number(limit) : undefined);
  }

  /** Staff-only manual override — appends a 'manual' rate and audits it. */
  @Post('override')
  @HttpCode(201)
  @UseGuards(RolesGuard)
  @Roles('YOHO_STAFF', 'YOHO_ADMIN')
  override(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(fxOverrideSchema)) dto: FxOverrideDto,
  ) {
    return this.fx.override(user, dto);
  }
}
