import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StepUpController } from './step-up.controller';
import { StepUpService } from './step-up.service';
import { TenantRoleGuard } from '../common/tenant-role';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController, StepUpController],
  providers: [AuthService, JwtAuthGuard, TenantGuard, TenantRoleGuard, StepUpService],
  exports: [JwtAuthGuard, JwtModule, StepUpService],
})
export class AuthModule {}
