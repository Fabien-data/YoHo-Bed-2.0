import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewsService } from './reviews.service';
import { submitReviewSchema, type SubmitReviewDto } from './dto';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /** Public: what the review form shows. The token is the authorization. */
  @Get('reviews/invite/:token')
  inviteInfo(@Param('token') token: string) {
    return this.reviewsService.inviteInfo(token);
  }

  /** Public, single-use submission. */
  @Post('reviews')
  @HttpCode(200)
  submit(@Body(new ZodValidationPipe(submitReviewSchema)) dto: SubmitReviewDto) {
    return this.reviewsService.submit(dto);
  }

  /** Owner: all reviews + per-property averages. */
  @Get('reviews')
  @UseGuards(JwtAuthGuard, TenantGuard)
  list(@TenantId() tenantId: string) {
    return this.reviewsService.listForTenant(tenantId);
  }
}
