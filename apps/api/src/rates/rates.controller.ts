import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import type { AuthPrincipal } from '../auth/dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RatesService } from './rates.service';
import {
  setPriceSchema,
  createRatePlanSchema,
  createOccupancySchema,
  createSeasonSchema,
  applySeasonSchema,
  lastMinuteDropSchema,
  type SetPriceDto,
  type CreateRatePlanDto,
  type CreateOccupancyDto,
  type CreateSeasonDto,
  type ApplySeasonDto,
  type LastMinuteDropDto,
} from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  /** Global meal-plan lookup used when building rate plans. */
  @Get('rate-codes')
  rateCodes() {
    return this.rates.listRateCodes();
  }

  @Get('rooms/:id/rates')
  getRates(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.rates.getRoomRates(tenantId, roomId, from, to);
  }

  @Get('rooms/:id/rate-plans')
  listRatePlans(@TenantId() tenantId: string, @Param('id') roomId: string) {
    return this.rates.listRatePlans(tenantId, roomId);
  }

  @Post('rooms/:id/rate-plans')
  @HttpCode(201)
  createRatePlan(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Body(new ZodValidationPipe(createRatePlanSchema)) dto: CreateRatePlanDto,
  ) {
    return this.rates.createRatePlan(tenantId, roomId, dto.rateCodeId);
  }

  @Get('rate-plans/:id/occupancies')
  listOccupancies(@TenantId() tenantId: string, @Param('id') ratePlanId: string) {
    return this.rates.listOccupancies(tenantId, ratePlanId);
  }

  @Post('rate-plans/:id/occupancies')
  @HttpCode(201)
  createOccupancy(
    @TenantId() tenantId: string,
    @Param('id') ratePlanId: string,
    @Body(new ZodValidationPipe(createOccupancySchema)) dto: CreateOccupancyDto,
  ) {
    return this.rates.createOccupancy(tenantId, ratePlanId, dto.label, dto.accommodates);
  }

  @Post('occupancies/:id/price')
  @HttpCode(200)
  setPrice(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') occupancyId: string,
    @Body(new ZodValidationPipe(setPriceSchema)) dto: SetPriceDto,
  ) {
    return this.rates.setPriceRange(tenantId, occupancyId, dto.from, dto.to, dto.base, user.email);
  }

  @Post('occupancies/:id/last-minute-drop')
  @HttpCode(200)
  lastMinuteDrop(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') occupancyId: string,
    @Body(new ZodValidationPipe(lastMinuteDropSchema)) dto: LastMinuteDropDto,
  ) {
    return this.rates.setLastMinuteDrop(
      tenantId,
      occupancyId,
      dto.from,
      dto.to,
      dto.dropPct,
      user.email,
    );
  }

  @Get('properties/:id/seasons')
  listSeasons(@TenantId() tenantId: string, @Param('id') propertyId: string) {
    return this.rates.listSeasons(tenantId, propertyId);
  }

  @Post('properties/:id/seasons')
  @HttpCode(201)
  createSeason(
    @TenantId() tenantId: string,
    @Param('id') propertyId: string,
    @Body(new ZodValidationPipe(createSeasonSchema)) dto: CreateSeasonDto,
  ) {
    return this.rates.createSeason(tenantId, propertyId, dto.name, dto.from, dto.to);
  }

  @Post('seasons/:id/apply')
  @HttpCode(200)
  applySeason(
    @TenantId() tenantId: string,
    @Param('id') seasonId: string,
    @Body(new ZodValidationPipe(applySeasonSchema)) dto: ApplySeasonDto,
  ) {
    return this.rates.applySeason(tenantId, seasonId, dto.prices);
  }
}
