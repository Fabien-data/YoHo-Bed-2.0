import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../tenancy/tenant.guard';
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
  async list(@TenantId() tenantId: string, @Req() request: TenantRequest) {
    const values = await this.properties.list(tenantId);
    const granted = request.grantedPropertyIds
      ? values.filter((value) => request.grantedPropertyIds!.includes(value.id))
      : values;
    if (
      request.hotelPermissions &&
      !request.hotelPermissions.includes('financial_read') &&
      !request.hotelPermissions.includes('setup')
    ) {
      return granted.map(({ id, name, code, currency, timezone, countryCode }) => ({
        id,
        name,
        code,
        currency,
        timezone,
        countryCode,
      }));
    }
    return granted;
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
