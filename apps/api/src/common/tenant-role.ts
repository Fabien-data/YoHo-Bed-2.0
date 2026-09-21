import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantRequest } from '../tenancy/tenant.guard';

/**
 * The caller's role INSIDE the active tenant — as opposed to `@Roles()`, which gates YoHo staff
 * routes on the memberships carried in the token.
 *
 * A hotel has two roles: OWNER runs the property; OWNER_STAFF works the desk. Configuration and
 * price authority belong to the owner, so those routes say `@TenantRoles('OWNER')`.
 */
export type TenantRole =
  'OWNER' | 'OWNER_STAFF' | 'HOUSEKEEPING_ATTENDANT' | 'HOUSEKEEPING_SUPERVISOR';

export const TENANT_ROLES_KEY = 'tenantRoles';

/** Restrict a route to callers holding one of these roles in the active tenant. */
export const TenantRoles = (...roles: TenantRole[]) => SetMetadata(TENANT_ROLES_KEY, roles);

/** Must run AFTER TenantGuard, which resolves `req.role` from the caller's membership. */
@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[]>(TENANT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const role = context.switchToHttp().getRequest<TenantRequest>().role;
    if (!role || !required.includes(role as TenantRole)) {
      throw new ForbiddenException('Only the property owner can do this');
    }
    return true;
  }
}

/** The caller's role in the active tenant (requires TenantGuard). */
export const CurrentTenantRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantRole | undefined =>
    ctx.switchToHttp().getRequest<TenantRequest>().role as TenantRole | undefined,
);
