import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  auditLog,
  hotelRoleAssignments,
  hotelRoleProperties,
  hotelRoles,
  memberships,
  properties,
  users,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { RoleDefinitionDto } from './hotel-roles.dto';

export const ROLE_TEMPLATES = [
  {
    name: 'Front desk',
    permissions: [
      'reservation_read',
      'reservation_change',
      'check_in_out',
      'room_assignment',
      'financial_read',
    ],
  },
  { name: 'Housekeeping', permissions: ['housekeeping'] },
  {
    name: 'Front desk supervisor',
    permissions: [
      'reservation_read',
      'reservation_change',
      'check_in_out',
      'room_assignment',
      'financial_read',
    ],
  },
] as const;

@Injectable()
export class HotelRolesService {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [roles, grants, assignments] = await Promise.all([
        tx.select().from(hotelRoles).orderBy(hotelRoles.name),
        tx.select().from(hotelRoleProperties),
        tx
          .select({
            roleId: hotelRoleAssignments.roleId,
            membershipId: hotelRoleAssignments.membershipId,
            userId: memberships.userId,
            name: users.name,
            email: users.email,
          })
          .from(hotelRoleAssignments)
          .innerJoin(memberships, eq(memberships.id, hotelRoleAssignments.membershipId))
          .innerJoin(users, eq(users.id, memberships.userId)),
      ]);
      return roles.map((role) => ({
        ...role,
        propertyIds: grants
          .filter((grant) => grant.roleId === role.id)
          .map((grant) => grant.propertyId),
        members: assignments
          .filter((item) => item.roleId === role.id)
          .map(({ roleId: _, ...member }) => member),
      }));
    });
  }

  private async checkedProperties(tx: Tx, tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.tenantId, tenantId), inArray(properties.id, ids)));
    if (found.length !== ids.length)
      throw new BadRequestException('Every granted property must belong to this hotel.');
  }

  private async writeGrants(tx: Tx, tenantId: string, roleId: string, ids: string[]) {
    await this.checkedProperties(tx, tenantId, ids);
    await tx.delete(hotelRoleProperties).where(eq(hotelRoleProperties.roleId, roleId));
    if (ids.length)
      await tx
        .insert(hotelRoleProperties)
        .values(ids.map((propertyId) => ({ tenantId, roleId, propertyId })));
  }

  async create(tenantId: string, actorId: string, dto: RoleDefinitionDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      await this.checkedProperties(tx, tenantId, dto.propertyIds);
      let role;
      try {
        [role] = await tx
          .insert(hotelRoles)
          .values({ tenantId, name: dto.name, permissions: dto.permissions })
          .returning();
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('A role with this name already exists.');
        throw error;
      }
      await this.writeGrants(tx, tenantId, role!.id, dto.propertyIds);
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'hotel_role.created',
        entity: 'hotel_role',
        entityId: role!.id,
        detail: { permissions: dto.permissions, propertyIds: dto.propertyIds },
      });
      return role;
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: RoleDefinitionDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(hotelRoles)
        .where(eq(hotelRoles.id, id))
        .for('update');
      if (!before) throw new NotFoundException('Role not found');
      const oldGrants = await tx
        .select({ propertyId: hotelRoleProperties.propertyId })
        .from(hotelRoleProperties)
        .where(eq(hotelRoleProperties.roleId, id));
      await this.checkedProperties(tx, tenantId, dto.propertyIds);
      let role;
      try {
        [role] = await tx
          .update(hotelRoles)
          .set({ name: dto.name, permissions: dto.permissions, updatedAt: new Date() })
          .where(eq(hotelRoles.id, id))
          .returning();
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('A role with this name already exists.');
        throw error;
      }
      await this.writeGrants(tx, tenantId, id, dto.propertyIds);
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'hotel_role.changed',
        entity: 'hotel_role',
        entityId: id,
        detail: {
          before: {
            permissions: before.permissions,
            propertyIds: oldGrants.map((item) => item.propertyId),
          },
          after: { permissions: dto.permissions, propertyIds: dto.propertyIds },
        },
      });
      return role;
    });
  }

  async assign(tenantId: string, actorId: string, roleId: string, userId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [role] = await tx
        .select({ id: hotelRoles.id })
        .from(hotelRoles)
        .where(eq(hotelRoles.id, roleId));
      if (!role) throw new NotFoundException('Role not found');
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
      if (!membership) throw new NotFoundException('Hotel team member not found');
      if (membership.role === 'OWNER')
        throw new BadRequestException('Owner recovery access cannot be replaced.');
      const [before] = await tx
        .select({ roleId: hotelRoleAssignments.roleId })
        .from(hotelRoleAssignments)
        .where(eq(hotelRoleAssignments.membershipId, membership.id));
      const [saved] = await tx
        .insert(hotelRoleAssignments)
        .values({ tenantId, membershipId: membership.id, roleId })
        .onConflictDoUpdate({
          target: hotelRoleAssignments.membershipId,
          set: { roleId, updatedAt: new Date() },
        })
        .returning();
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'hotel_role.assigned',
        entity: 'membership',
        entityId: membership.id,
        detail: { userId, previousRoleId: before?.roleId ?? null, roleId },
      });
      return saved;
    });
  }

  async unassign(tenantId: string, actorId: string, roleId: string, userId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
      if (!membership) throw new NotFoundException('Hotel team member not found');
      const [revoked] = await tx
        .update(hotelRoleAssignments)
        .set({ roleId: null, updatedAt: new Date() })
        .where(
          and(
            eq(hotelRoleAssignments.membershipId, membership.id),
            eq(hotelRoleAssignments.roleId, roleId),
          ),
        )
        .returning();
      if (!revoked) throw new NotFoundException('This role is not assigned to that team member.');
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actorId,
        action: 'hotel_role.removed',
        entity: 'membership',
        entityId: membership.id,
        detail: { userId, roleId },
      });
      return { removed: true };
    });
  }
}
