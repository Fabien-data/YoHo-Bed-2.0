import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import {
  hotelRoleAssignments,
  hotelRoleProperties,
  hotelRoles,
  memberships,
  tenants,
  type HotelPermission,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { AuthPrincipal } from '../auth/dto';
import { accessRule, propertyForAccess } from './hotel-access';

export interface TenantRequest extends Request {
  user?: AuthPrincipal;
  tenantId?: string;
  role?: string;
  hotelRoleId?: string;
  hotelPermissions?: HotelPermission[];
  grantedPropertyIds?: string[];
  hotelActionAllowed?: boolean;
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

    const [current] = await this.dbs.db
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, active as string), eq(memberships.userId, user.sub)));
    if (!current) throw new ForbiddenException('Hotel membership was removed. Sign in again.');
    req.tenantId = active as string;
    req.role = current.role;
    membership.role = current.role; // Update the request principal as well as the route guard.
    const assignment = await this.dbs.withTenant(active as string, async (tx) => {
      const [assigned] = await tx
        .select({ roleId: hotelRoleAssignments.roleId, permissions: hotelRoles.permissions })
        .from(hotelRoleAssignments)
        .leftJoin(hotelRoles, eq(hotelRoles.id, hotelRoleAssignments.roleId))
        .where(eq(hotelRoleAssignments.membershipId, current.id));
      if (!assigned) return null;
      const grants = assigned.roleId
        ? await tx
            .select({ propertyId: hotelRoleProperties.propertyId })
            .from(hotelRoleProperties)
            .where(eq(hotelRoleProperties.roleId, assigned.roleId))
        : [];
      const target = await propertyForAccess(
        tx,
        req,
        accessRule(req.method, req.path)?.resource ?? 'none',
      );
      return {
        ...assigned,
        permissions: assigned.permissions ?? [],
        grants: grants.map((grant) => grant.propertyId),
        target,
      };
    });
    if (assignment) {
      if (current.role === 'OWNER')
        throw new ForbiddenException('Owner access cannot be replaced by a hotel role.');
      const policy = accessRule(req.method, req.path);
      if (!policy) throw new ForbiddenException('This action is not available to this hotel role.');
      if (
        !policy.any.some((permission) => assignment.permissions.includes(permission)) ||
        policy.all?.some((permission) => !assignment.permissions.includes(permission))
      )
        throw new ForbiddenException('Your hotel role does not permit this action.');
      if (
        policy.listProperties
          ? assignment.grants.length === 0
          : policy.resource !== 'none' &&
            (!assignment.target || !assignment.grants.includes(assignment.target))
      )
        throw new ForbiddenException('This property is not granted to your hotel role.');
      req.role = 'CUSTOM';
      req.hotelRoleId = assignment.roleId ?? undefined;
      req.hotelPermissions = assignment.permissions;
      req.grantedPropertyIds = assignment.grants;
      req.hotelActionAllowed = true;
      return true;
    }
    if (
      (current.role === 'HOUSEKEEPING_ATTENDANT' || current.role === 'HOUSEKEEPING_SUPERVISOR') &&
      !this.housekeepingRouteAllowed(req.method, req.path, current.role)
    ) {
      throw new ForbiddenException('This housekeeping account only has access to room operations');
    }
    return true;
  }

  private housekeepingRouteAllowed(method: string, path: string, role: string): boolean {
    // UX measurement and the pulse survey are for every role: housekeeping is staff too.
    if ((method === 'GET' || method === 'POST') && /^\/ux\/(events|survey)\/?$/.test(path))
      return true;
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
