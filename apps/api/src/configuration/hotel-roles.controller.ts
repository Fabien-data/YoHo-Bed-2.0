import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { HotelRolesService, ROLE_TEMPLATES } from './hotel-roles.service';
import {
  roleAssignmentSchema,
  roleDefinitionSchema,
  type RoleAssignmentDto,
  type RoleDefinitionDto,
} from './hotel-roles.dto';

@Controller('hotel-roles')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
@TenantRoles('OWNER')
export class HotelRolesController {
  constructor(private readonly service: HotelRolesService) {}
  @Get('templates') templates() {
    return ROLE_TEMPLATES;
  }
  @Get() list(@TenantId() tenantId: string) {
    return this.service.list(tenantId);
  }
  @Post() create(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Body(new ZodValidationPipe(roleDefinitionSchema)) dto: RoleDefinitionDto,
  ) {
    return this.service.create(tenantId, actor.sub, dto);
  }
  @Patch(':id') update(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleDefinitionSchema)) dto: RoleDefinitionDto,
  ) {
    return this.service.update(tenantId, actor.sub, id, dto);
  }
  @Post(':id/assign') assign(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleAssignmentSchema)) dto: RoleAssignmentDto,
  ) {
    return this.service.assign(tenantId, actor.sub, id, dto.userId);
  }
  @Delete(':id/assign/:userId') unassign(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.service.unassign(tenantId, actor.sub, id, userId);
  }
}
