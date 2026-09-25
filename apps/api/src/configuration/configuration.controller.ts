import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ConfigurationService } from './configuration.service';
import { MastersService } from './masters.service';
import { geocodeAddress } from './geocode';
import {
  applyPresetSchema,
  createBusinessSourceSchema,
  createMarketSegmentSchema,
  createPaymentMethodSchema,
  createSalesPersonSchema,
  updateBusinessSourceSchema,
  updateMarketSegmentSchema,
  updatePaymentMethodSchema,
  updatePropertyProfileSchema,
  updatePropertySettingsSchema,
  updateSalesPersonSchema,
  type ApplyPresetDto,
  type CreateBusinessSourceDto,
  type CreateMarketSegmentDto,
  type CreatePaymentMethodDto,
  type CreateSalesPersonDto,
  type UpdateBusinessSourceDto,
  type UpdateMarketSegmentDto,
  type UpdatePaymentMethodDto,
  type UpdatePropertyProfileDto,
  type UpdatePropertySettingsDto,
  type UpdateSalesPersonDto,
} from './dto';

/**
 * Yanolja's "Configuration" for the reservation desk (Development Phase 02).
 *
 * Reads are open to everyone in the tenant — desk staff need the lists to take a booking — and
 * are not plan-gated, because every plan takes reservations. Writes belong to the owner.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class ConfigurationController {
  constructor(
    private readonly config: ConfigurationService,
    private readonly masters: MastersService,
  ) {}

  // --- Property profile & settings --------------------------------------------

  @Patch('properties/:id/profile')
  @TenantRoles('OWNER')
  updateProfile(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePropertyProfileSchema)) dto: UpdatePropertyProfileDto,
  ) {
    return this.config.updateProfile(tenantId, id, dto);
  }

  /** Find the address on the map (Hotel Profile). The owner's, like the rest of the profile. */
  @Get('properties/:id/geocode')
  @TenantRoles('OWNER')
  async geocode(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('q') q: string | undefined,
  ) {
    const property = await this.config.getProfile(tenantId, id);
    return geocodeAddress(q ?? '', property.countryCode);
  }

  @Get('properties/:id/settings')
  getSettings(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.config.getSettings(tenantId, id);
  }

  @Patch('properties/:id/settings')
  @TenantRoles('OWNER')
  updateSettings(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePropertySettingsSchema)) dto: UpdatePropertySettingsDto,
  ) {
    return this.config.updateSettings(tenantId, id, dto);
  }

  /** Everything the reservation screens need in one call. */
  @Get('properties/:id/reservation-config')
  reservationConfig(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.config.reservationConfig(tenantId, id);
  }

  // --- Business sources --------------------------------------------------------

  @Get('business-sources')
  listSources(@TenantId() tenantId: string) {
    return this.masters.listBusinessSources(tenantId);
  }

  @Post('business-sources')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createSource(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createBusinessSourceSchema)) dto: CreateBusinessSourceDto,
  ) {
    return this.masters.createBusinessSource(tenantId, dto);
  }

  @Patch('business-sources/:id')
  @TenantRoles('OWNER')
  updateSource(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBusinessSourceSchema)) dto: UpdateBusinessSourceDto,
  ) {
    return this.masters.updateBusinessSource(tenantId, id, dto);
  }

  // --- Market segments ---------------------------------------------------------

  @Get('market-segments')
  listSegments(@TenantId() tenantId: string) {
    return this.masters.listMarketSegments(tenantId);
  }

  @Post('market-segments')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createSegment(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createMarketSegmentSchema)) dto: CreateMarketSegmentDto,
  ) {
    return this.masters.createMarketSegment(tenantId, dto);
  }

  @Patch('market-segments/:id')
  @TenantRoles('OWNER')
  updateSegment(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMarketSegmentSchema)) dto: UpdateMarketSegmentDto,
  ) {
    return this.masters.updateMarketSegment(tenantId, id, dto);
  }

  // --- Payment methods ---------------------------------------------------------

  @Get('payment-methods')
  listMethods(@TenantId() tenantId: string) {
    return this.masters.listPaymentMethods(tenantId);
  }

  @Post('payment-methods')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createMethod(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createPaymentMethodSchema)) dto: CreatePaymentMethodDto,
  ) {
    return this.masters.createPaymentMethod(tenantId, dto);
  }

  @Patch('payment-methods/:id')
  @TenantRoles('OWNER')
  updateMethod(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePaymentMethodSchema)) dto: UpdatePaymentMethodDto,
  ) {
    return this.masters.updatePaymentMethod(tenantId, id, dto);
  }

  // --- Sales persons -----------------------------------------------------------

  @Get('sales-persons')
  listSalesPersons(@TenantId() tenantId: string) {
    return this.masters.listSalesPersons(tenantId);
  }

  @Post('sales-persons')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createSalesPerson(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createSalesPersonSchema)) dto: CreateSalesPersonDto,
  ) {
    return this.masters.createSalesPerson(tenantId, dto);
  }

  @Patch('sales-persons/:id')
  @TenantRoles('OWNER')
  updateSalesPerson(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalesPersonSchema)) dto: UpdateSalesPersonDto,
  ) {
    return this.masters.updateSalesPerson(tenantId, id, dto);
  }

  // --- Presets -----------------------------------------------------------------

  /** Add a country's preset lists (segments, sources, payment methods) that are still missing. */
  @Post('configuration/apply-preset')
  @HttpCode(200)
  @TenantRoles('OWNER')
  applyPreset(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(applyPresetSchema)) dto: ApplyPresetDto,
  ) {
    return this.masters.applyPreset(tenantId, dto.country);
  }
}
