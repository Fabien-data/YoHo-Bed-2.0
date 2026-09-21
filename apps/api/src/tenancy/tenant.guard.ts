import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { tenants } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
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
  constructor(private readonly dbs: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    // Suspension takes effect immediately, not at next login (Compartment H). 'pending' owners
    // may keep working — they are setting up while awaiting approval.
    const [t] = await this.dbs.db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, active as string));
    if (!t || t.status === 'suspended' || t.status === 'inactive') {
      throw new ForbiddenException('This account is suspended. Contact YoHoBed support.');
    }

    req.tenantId = active as string;
    req.role = membership.role;
    if (
      (membership.role === 'HOUSEKEEPING_ATTENDANT' ||
        membership.role === 'HOUSEKEEPING_SUPERVISOR') &&
      !this.housekeepingRouteAllowed(req.method, req.path, membership.role)
    ) {
      throw new ForbiddenException('This housekeeping account only has access to room operations');
    }
    return true;
  }

  private housekeepingRouteAllowed(method: string, path: string, role: string): boolean {
    const read = method === 'GET';
    if (
      read &&
      [
        /^\/properties\/?$/,
        /^\/profile\/?$/,
        /^\/billing\/entitlements\/?$/,
        /^\/room-view\/?$/,
        /^\/room-updates\/?$/,
        /^\/house-status\/summary\/?$/,
        /^\/properties\/[^/]+\/floor-layouts\/?$/,
        /^\/properties\/[^/]+\/housekeeping\/tasks\/?$/,
        /^\/properties\/[^/]+\/work-orders\/?$/,
        /^\/notifications(?:\/.*)?$/,
      ].some((pattern) => pattern.test(path))
    )
      return true;
    if (read && role === 'HOUSEKEEPING_SUPERVISOR' && /^\/auth\/staff\/?$/.test(path)) return true;
    if (
      method === 'PATCH' &&
      (/^\/housekeeping\/tasks\/[^/]+\/?$/.test(path) || /^\/work-orders\/[^/]+\/?$/.test(path))
    )
      return true;
    if (
      method === 'POST' &&
      (/^\/properties\/[^/]+\/housekeeping\/?$/.test(path) ||
        /^\/properties\/[^/]+\/housekeeping\/mark-departures-dirty\/?$/.test(path))
    )
      return true;
    if (role === 'HOUSEKEEPING_SUPERVISOR') {
      if (method === 'PUT' && /^\/properties\/[^/]+\/floor-layouts\/?$/.test(path)) return true;
      if (method === 'POST' && /^\/properties\/[^/]+\/work-orders\/?$/.test(path)) return true;
    }
    return false;
  }
}
