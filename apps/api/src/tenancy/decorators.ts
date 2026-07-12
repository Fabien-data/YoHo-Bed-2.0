import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/dto';
import type { TenantRequest } from './tenant.guard';

/** The authenticated principal (requires JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    return ctx.switchToHttp().getRequest<TenantRequest>().user as AuthPrincipal;
  },
);

/** The resolved, authorized active tenant id (requires TenantGuard). */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<TenantRequest>().tenantId as string;
});
