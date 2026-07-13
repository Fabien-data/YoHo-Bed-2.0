import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CommercialService } from './commercial.service';
import {
  createPromotionSchema,
  createCouponSchema,
  createReferralPartnerSchema,
  type CreatePromotionDto,
  type CreateCouponDto,
  type CreateReferralPartnerDto,
} from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class CommercialController {
  constructor(private readonly commercial: CommercialService) {}

  // --- Promotions ---
  @Get('properties/:id/promotions')
  listPromotions(@TenantId() tenantId: string, @Param('id') propertyId: string) {
    return this.commercial.listPromotions(tenantId, propertyId);
  }

  @Post('properties/:id/promotions')
  @HttpCode(201)
  createPromotion(
    @TenantId() tenantId: string,
    @Param('id') propertyId: string,
    @Body(new ZodValidationPipe(createPromotionSchema)) dto: CreatePromotionDto,
  ) {
    return this.commercial.createPromotion(tenantId, propertyId, dto);
  }

  @Post('promotions/:id/apply')
  @HttpCode(200)
  applyPromotion(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.commercial.applyPromotion(tenantId, id);
  }

  @Delete('promotions/:id')
  deletePromotion(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.commercial.deletePromotion(tenantId, id);
  }

  // --- Coupons ---
  @Get('coupons')
  listCoupons(@TenantId() tenantId: string) {
    return this.commercial.listCoupons(tenantId);
  }

  @Post('coupons')
  @HttpCode(201)
  createCoupon(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createCouponSchema)) dto: CreateCouponDto,
  ) {
    return this.commercial.createCoupon(tenantId, dto);
  }

  @Delete('coupons/:id')
  deleteCoupon(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.commercial.deleteCoupon(tenantId, id);
  }

  // --- Referrals ---
  @Get('referral-partners')
  listPartners(@TenantId() tenantId: string) {
    return this.commercial.listReferralPartners(tenantId);
  }

  @Post('referral-partners')
  @HttpCode(201)
  createPartner(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createReferralPartnerSchema)) dto: CreateReferralPartnerDto,
  ) {
    return this.commercial.createReferralPartner(tenantId, dto);
  }

  @Delete('referral-partners/:id')
  deletePartner(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.commercial.deleteReferralPartner(tenantId, id);
  }

  @Get('referral-commissions')
  listCommissions(@TenantId() tenantId: string) {
    return this.commercial.listReferralCommissions(tenantId);
  }
}
