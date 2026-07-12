import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from '../auth/dto';

export interface TenantRequest extends Request {
  user?: AuthPrincipal;
  tenantId?: string;
  role?: string;
}

/**
 * Resolves and authorizes the active tenant for a request. Must run AFTER JwtAuthGuard.
 *
 * The active tenant comes from the `x-tenant-id` header, or is inferred when the user belongs to
 * exactly one tenant. Crucially, it is accepted ONLY if it appears in the caller's memberships —
 * so a crafted header or URL id can never reach another tenant's data. This closes the legacy
 * "URL param overrides session" hole (and there is no email allow-list backdoor).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const scoped = user.memberships.filter((m) => m.tenantId !== null);
    const requested = (req.headers['x-tenant-id'] as string | undefined)?.trim();
    const active = requested ?? (scoped.length === 1 ? scoped[0]!.tenantId : undefined);

    if (!active) {
      throw new ForbiddenException('No active tenant selected (set the x-tenant-id header)');
    }
    const membership = scoped.find((m) => m.tenantId === active);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this tenant');
    }

    req.tenantId = active as string;
    req.role = membership.role;
    return true;
  }
}
