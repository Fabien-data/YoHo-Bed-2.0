import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ListsService } from './lists.service';
import {
  LIST_SCHEMAS,
  holidayRangeSchema,
  isListKey,
  setGuestAttributesSchema,
  type HolidayRangeDto,
  type ListKey,
  type SetGuestAttributesDto,
} from './lists.dto';

function keyOf(raw: string): ListKey {
  if (!isListKey(raw)) throw new BadRequestException(`There is no list called "${raw}"`);
  return raw;
}

function parse(key: ListKey, kind: 'create' | 'update', body: unknown) {
  return new ZodValidationPipe(LIST_SCHEMAS[key][kind]).transform(body) as Record<string, unknown>;
}

/**
 * Configuration's short lists (owner brief, 2026-09-26): /configuration/lists/holidays,
 * guest-attributes, discounts, remarks, payout-types. Reads are open to everyone in the hotel;
 * changes are the owner's.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get('configuration/lists/:list')
  list(
    @TenantId() tenantId: string,
    @Param('list') list: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.lists.list(tenantId, keyOf(list), propertyId);
  }

  @Post('configuration/lists/:list')
  @HttpCode(201)
  @TenantRoles('OWNER')
  create(
    @TenantId() tenantId: string,
    @Param('list') list: string,
    @Body() body: unknown,
    @Query('propertyId') propertyId?: string,
  ) {
    const key = keyOf(list);
    return this.lists.create(tenantId, key, parse(key, 'create', body), propertyId);
  }

  @Patch('configuration/lists/:list/:id')
  @TenantRoles('OWNER')
  update(
    @TenantId() tenantId: string,
    @Param('list') list: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const key = keyOf(list);
    return this.lists.update(tenantId, key, id, parse(key, 'update', body));
  }

  @Delete('configuration/lists/:list/:id')
  @TenantRoles('OWNER')
  remove(@TenantId() tenantId: string, @Param('list') list: string, @Param('id') id: string) {
    return this.lists.remove(tenantId, keyOf(list), id);
  }

  /** The holidays in a date range, yearly ones repeated — for the calendars' headers. */
  @Get('properties/:propertyId/holidays')
  holidays(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Query(new ZodValidationPipe(holidayRangeSchema)) q: HolidayRangeDto,
  ) {
    return this.lists.holidaysBetween(tenantId, propertyId, q.from, q.to);
  }

  @Get('customers/:id/attributes')
  attributes(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.lists.attributesOf(tenantId, id);
  }

  /** The desk labels a guest, so every screen shows it on their stays. */
  @Put('customers/:id/attributes')
  setAttributes(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setGuestAttributesSchema)) dto: SetGuestAttributesDto,
  ) {
    return this.lists.setAttributes(tenantId, id, dto.attributeIds);
  }
}
