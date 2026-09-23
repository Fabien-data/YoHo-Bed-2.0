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
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { FolioService } from './folio.service';
import {
  createParticularSchema,
  updateParticularSchema,
  type UpdateParticularDto,
  openFolioSchema,
  postChargeSchema,
  recordFolioPaymentSchema,
  refundSchema,
  transferChargesSchema,
  unsettledQuerySchema,
  voidChargeSchema,
  type CreateParticularDto,
  type OpenFolioDto,
  type PostChargeDto,
  type RecordFolioPaymentDto,
  type RefundDto,
  type TransferChargesDto,
  type UnsettledQueryDto,
  type VoidChargeDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';
import { CurrentTenantRole, type TenantRole } from '../common/tenant-role';

/** The guest bill. Pro and above — a Starter hotel gets the front desk, not the cashier. */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard)
@Feature('folio')
export class FolioController {
  constructor(private readonly folio: FolioService) {}

  @Get('bookings/:id/folio')
  forBooking(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.folio.forBooking(tenantId, id);
  }

  @Post('bookings/:id/folio/windows')
  @HttpCode(201)
  openWindow(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(openFolioSchema)) dto: OpenFolioDto,
  ) {
    return this.folio.openWindow(tenantId, id, dto);
  }

  /** Copy the room charges off the booking_days snapshot. Idempotent. */
  @Post('bookings/:id/folio/post-room-charges')
  @HttpCode(200)
  postRoomCharges(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.folio.postRoomCharges(tenantId, id, user.sub);
  }

  @Post('folios/:id/charges')
  @HttpCode(201)
  postCharge(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(postChargeSchema)) dto: PostChargeDto,
  ) {
    return this.folio.postCharge(tenantId, id, user.sub, dto);
  }

  @Post('folio-charges/:id/void')
  @HttpCode(200)
  voidCharge(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidChargeSchema)) dto: VoidChargeDto,
  ) {
    return this.folio.voidCharge(tenantId, id, dto, user.sub);
  }

  /** Split the bill: move charges between windows of the same booking. */
  @Post('folio-charges/transfer')
  @HttpCode(200)
  transfer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(transferChargesSchema)) dto: TransferChargesDto,
  ) {
    return this.folio.transfer(tenantId, user.sub, dto);
  }

  @Post('folios/:id/payments')
  @HttpCode(201)
  recordPayment(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordFolioPaymentSchema)) dto: RecordFolioPaymentDto,
  ) {
    return this.folio.recordPayment(tenantId, id, dto, user.sub);
  }

  /**
   * Give money back to the guest (UX-1b): never more than was paid on the window, always with a
   * reason, and the owner's approval for anyone else (step-up action `refund`).
   */
  @Post('folios/:id/refunds')
  @HttpCode(201)
  refund(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: TenantRole | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundSchema)) dto: RefundDto,
  ) {
    return this.folio.refund(tenantId, id, dto, { userId: user.sub, role });
  }

  /** Close a window. Refuses on a non-zero balance unless `force` is asked for explicitly. */
  @Post('folios/:id/close')
  @HttpCode(200)
  close(@TenantId() tenantId: string, @Param('id') id: string, @Query('force') force?: string) {
    return this.folio.closeWindow(tenantId, id, force === 'true');
  }

  /** Every stay that still owes money — the night manager's worklist. */
  @Get('folios/unsettled')
  unsettled(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(unsettledQuerySchema)) q: UnsettledQueryDto,
  ) {
    return this.folio.unsettled(tenantId, q.propertyId);
  }

  @Get('charge-particulars')
  listParticulars(@TenantId() tenantId: string) {
    return this.folio.listParticulars(tenantId);
  }

  @Post('charge-particulars')
  @HttpCode(201)
  createParticular(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createParticularSchema)) dto: CreateParticularDto,
  ) {
    return this.folio.createParticular(tenantId, dto);
  }

  @Patch('charge-particulars/:id')
  updateParticular(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateParticularSchema)) dto: UpdateParticularDto,
  ) {
    return this.folio.updateParticular(tenantId, id, dto);
  }
}
