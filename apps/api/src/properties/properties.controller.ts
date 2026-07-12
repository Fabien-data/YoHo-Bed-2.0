import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PropertyService } from './property.service';
import {
  createPropertySchema,
  updatePropertySchema,
  type CreatePropertyDto,
  type UpdatePropertyDto,
} from './dto';

@Controller('properties')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PropertiesController {
  constructor(private readonly properties: PropertyService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.properties.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.properties.get(tenantId, id);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createPropertySchema)) dto: CreatePropertyDto,
  ) {
    return this.properties.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePropertySchema)) dto: UpdatePropertyDto,
  ) {
    return this.properties.update(tenantId, id, dto);
  }
}
