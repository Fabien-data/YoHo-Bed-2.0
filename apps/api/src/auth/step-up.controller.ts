import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StepUpService } from './step-up.service';
import { stepUpSchema, type AuthPrincipal, type StepUpDto } from './dto';

@Controller('auth')
@UseGuards(JwtAuthGuard, TenantGuard)
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  /** An owner approves one over-the-limit action for the signed-in desk user. */
  @Post('step-up')
  @HttpCode(200)
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(stepUpSchema)) dto: StepUpDto,
  ) {
    return this.stepUp.approve(tenantId, user.sub, dto);
  }
}
