import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { RateTypesService } from './rate-types.service';
import {
  createOccupancyRowSchema,
  createRatePlanSchema,
  createRateTypeSchema,
  orderSchema,
  updateOccupancyRowSchema,
  updateRateTypeSchema,
  type CreateOccupancyRowDto,
  type CreateRatePlanDto,
  type CreateRateTypeDto,
  type OrderDto,
  type UpdateOccupancyRowDto,
  type UpdateRateTypeDto,
} from './rate-types.dto';

/**
 * Configuration → Rate types and Rate plans (owner brief, 2026-09-26). Everyone in the hotel
 * reads them; only the owner changes them.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class RateTypesController {
  constructor(private readonly rates: RateTypesService) {}

  @Get('properties/:propertyId/rate-types')
  listRateTypes(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.rates.listRateTypes(tenantId, propertyId);
  }

  @Post('properties/:propertyId/rate-types')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createRateType(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createRateTypeSchema)) dto: CreateRateTypeDto,
  ) {
    return this.rates.createRateType(tenantId, propertyId, dto);
  }

  @Put('properties/:propertyId/rate-types/order')
  @TenantRoles('OWNER')
  orderRateTypes(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(orderSchema)) dto: OrderDto,
  ) {
    return this.rates.reorderRateTypes(tenantId, propertyId, dto.ids);
  }

  @Patch('rate-types/:id')
  @TenantRoles('OWNER')
  updateRateType(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRateTypeSchema)) dto: UpdateRateTypeDto,
  ) {
    return this.rates.updateRateType(tenantId, id, dto);
  }

  @Delete('rate-types/:id')
  @TenantRoles('OWNER')
  deleteRateType(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.rates.deleteRateType(tenantId, id);
  }

  @Get('properties/:propertyId/rate-plans')
  listRatePlans(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.rates.listRatePlans(tenantId, propertyId);
  }

  @Post('properties/:propertyId/rate-plans')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createRatePlan(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createRatePlanSchema)) dto: CreateRatePlanDto,
  ) {
    return this.rates.createRatePlan(tenantId, propertyId, dto);
  }

  @Delete('rate-plans/:id')
  @TenantRoles('OWNER')
  deleteRatePlan(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.rates.deleteRatePlan(tenantId, id);
  }

  @Post('rate-plans/:id/guest-configurations')
  @HttpCode(201)
  @TenantRoles('OWNER')
  addOccupancy(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOccupancyRowSchema)) dto: CreateOccupancyRowDto,
  ) {
    return this.rates.addOccupancy(tenantId, id, dto);
  }

  @Patch('occupancies/:id')
  @TenantRoles('OWNER')
  updateOccupancy(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOccupancyRowSchema)) dto: UpdateOccupancyRowDto,
  ) {
    return this.rates.updateOccupancy(tenantId, id, dto);
  }

  @Delete('occupancies/:id')
  @TenantRoles('OWNER')
  deleteOccupancy(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.rates.deleteOccupancy(tenantId, id);
  }
}
