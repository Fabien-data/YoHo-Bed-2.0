import { Body, Controller, Get, HttpCode, Post, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../tenancy/decorators';
import { AuthService } from './auth.service';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type AuthPrincipal,
  type ForgotPasswordDto,
  type LoginDto,
  type ResetPasswordDto,
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

  // NOTE: self-registration is intentionally NOT exposed. Owners are onboarded by staff.
}
