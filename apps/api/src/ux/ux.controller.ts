import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { CurrentTenantRole, type TenantRole } from '../common/tenant-role';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { UxService } from './ux.service';
import {
  scoreboardQuerySchema,
  uxEventsSchema,
  uxSurveySchema,
  type ScoreboardQueryDto,
  type UxEventsDto,
  type UxSurveyDto,
} from './dto';

/** Hotel staff report what the product cost them — every role, housekeeping included. */
@Controller('ux')
@UseGuards(JwtAuthGuard, TenantGuard)
export class UxController {
  constructor(private readonly ux: UxService) {}

  /** A batch of task timings and client errors. Accepted and forgotten: never a reason to fail. */
  @Post('events')
  @HttpCode(202)
  events(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Body(new ZodValidationPipe(uxEventsSchema)) dto: UxEventsDto,
  ) {
    return this.ux.record({ tenantId, userId: user.sub, role }, dto);
  }

  @Get('survey')
  survey(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
  ) {
    return this.ux.survey({ tenantId, userId: user.sub, role });
  }

  @Post('survey')
  @HttpCode(201)
  answer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Body(new ZodValidationPipe(uxSurveySchema)) dto: UxSurveyDto,
  ) {
    return this.ux.answer({ tenantId, userId: user.sub, role }, dto);
  }
}

/** YoHo's own view: are we actually the easiest PMS to learn? */
@Controller('staff/ux')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('YOHO_STAFF', 'YOHO_ADMIN')
export class UxStaffController {
  constructor(private readonly ux: UxService) {}

  @Get('scoreboard')
  scoreboard(@Query(new ZodValidationPipe(scoreboardQuerySchema)) q: ScoreboardQueryDto) {
    return this.ux.scoreboard(q);
  }
}
