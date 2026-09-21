import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { AuthService } from './auth.service';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  inviteStaffSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateStaffSchema,
  type AuthPrincipal,
  type ChangePasswordDto,
  type ForgotPasswordDto,
  type InviteStaffDto,
  type LoginDto,
  type RegisterDto,
  type ResetPasswordDto,
  type UpdateStaffDto,
} from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    return { message: 'If that account exists, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { message: 'Password updated.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthPrincipal) {
    return { id: user.sub, email: user.email, memberships: user.memberships };
  }

  /** Self-serve owner signup (Compartment H): creates a PENDING tenant; staff approve it. */
  @Post('register')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(registerSchema))
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user.sub, dto);
    return { message: 'Password updated.' };
  }

  @Get('staff')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
  @TenantRoles('OWNER', 'HOUSEKEEPING_SUPERVISOR')
  staff(@TenantId() tenantId: string) {
    return this.auth.listStaff(tenantId);
  }

  @Post('staff')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
  @TenantRoles('OWNER')
  inviteStaff(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(inviteStaffSchema)) dto: InviteStaffDto,
  ) {
    return this.auth.inviteStaff(tenantId, dto);
  }

  @Patch('staff/:id')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
  @TenantRoles('OWNER')
  updateStaff(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffSchema)) dto: UpdateStaffDto,
  ) {
    return this.auth.updateStaff(tenantId, id, dto);
  }
}
