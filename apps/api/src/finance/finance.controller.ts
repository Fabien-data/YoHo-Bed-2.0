import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FinanceService } from './finance.service';
import {
  recordPaymentSchema,
  createPayoutSchema,
  type RecordPaymentDto,
  type CreatePayoutDto,
} from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // Invoices
  @Post('bookings/:id/invoice')
  @HttpCode(201)
  createInvoice(@TenantId() tenantId: string, @Param('id') bookingId: string) {
    return this.finance.createInvoiceForBooking(tenantId, bookingId);
  }

  @Get('invoices')
  listInvoices(@TenantId() tenantId: string) {
    return this.finance.listInvoices(tenantId);
  }

  @Get('invoices/:id')
  getInvoice(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.finance.getInvoice(tenantId, id);
  }

  // Payments
  @Post('bookings/:id/payments')
  @HttpCode(201)
  recordPayment(
    @TenantId() tenantId: string,
    @Param('id') bookingId: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) dto: RecordPaymentDto,
  ) {
    return this.finance.recordPayment(tenantId, bookingId, dto);
  }

  @Get('bookings/:id/payments')
  listPayments(@TenantId() tenantId: string, @Param('id') bookingId: string) {
    return this.finance.listPayments(tenantId, bookingId);
  }

  // Settlement / payouts / revenue
  @Get('finance/payout-statement')
  payoutStatement(
    @TenantId() tenantId: string,
    @Query('propertyId') propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.finance.payoutStatement(tenantId, propertyId, from, to);
  }

  @Post('finance/payouts')
  @HttpCode(201)
  createPayout(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createPayoutSchema)) dto: CreatePayoutDto,
  ) {
    return this.finance.createPayout(tenantId, dto.propertyId, dto.from, dto.to);
  }

  @Get('finance/payouts')
  listPayouts(@TenantId() tenantId: string) {
    return this.finance.listPayouts(tenantId);
  }

  @Get('finance/revenue')
  revenue(@TenantId() tenantId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.finance.revenueSummary(tenantId, from, to);
  }
}
