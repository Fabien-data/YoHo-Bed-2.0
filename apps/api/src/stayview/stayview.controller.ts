import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { EntitlementGuard } from '../common/entitlement.guard';
import { Feature } from '../common/feature.decorator';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StayViewService } from './stayview.service';
import { BlocksService } from './blocks.service';
import {
  createBlockSchema,
  stayViewQuerySchema,
  updateBlockSchema,
  type CreateBlockDto,
  type StayViewQueryDto,
  type UpdateBlockDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';
import type { TenantRequest } from '../tenancy/tenant.guard';

// The nav gates this screen on `stay_view`; without the same gate here the entitlement was
// enforced only by hiding a link — the endpoint stayed fully reachable via Ctrl-K or curl.
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard)
@Feature('stay_view')
export class StayViewController {
  constructor(
    private readonly stayView: StayViewService,
    private readonly blocks: BlocksService,
  ) {}

  /** The whole tape chart for a date window, in one request. */
  @Get('stayview')
  get(
    @TenantId() tenantId: string,
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(stayViewQuerySchema)) q: StayViewQueryDto,
  ) {
    return this.stayView.get(
      tenantId,
      q.propertyId,
      q.from,
      q.to,
      q.ratePlanId,
      !request.hotelPermissions || request.hotelPermissions.includes('financial_read'),
    );
  }

  @Get('properties/:propertyId/blocks')
  listBlocks(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.blocks.list(tenantId, propertyId);
  }

  @Post('properties/:propertyId/blocks')
  @HttpCode(201)
  createBlock(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createBlockSchema)) dto: CreateBlockDto,
  ) {
    return this.blocks.create(tenantId, propertyId, user.sub, dto);
  }

  @Patch('blocks/:id')
  updateBlock(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBlockSchema)) dto: UpdateBlockDto,
  ) {
    return this.blocks.update(tenantId, id, dto, user.sub);
  }

  /** "Unblock Room" — puts it back in service without erasing that it was ever blocked. */
  @Post('blocks/:id/release')
  @HttpCode(200)
  releaseBlock(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.blocks.release(tenantId, id, user.sub);
  }
}
