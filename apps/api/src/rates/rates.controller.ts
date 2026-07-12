import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RatesService } from './rates.service';
import { setPriceSchema, type SetPriceDto } from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get('rooms/:id/rates')
  getRates(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.rates.getRoomRates(tenantId, roomId, from, to);
  }

  @Post('occupancies/:id/price')
  @HttpCode(200)
  setPrice(
    @TenantId() tenantId: string,
    @Param('id') occupancyId: string,
    @Body(new ZodValidationPipe(setPriceSchema)) dto: SetPriceDto,
  ) {
    return this.rates.setPriceRange(tenantId, occupancyId, dto.from, dto.to, dto.base);
  }
}
