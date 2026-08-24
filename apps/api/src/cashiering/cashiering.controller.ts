import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { CashieringService } from './cashiering.service';
import {
  chargeToLedgerSchema,
  closeDrawerSchema,
  createBusinessSourceSchema,
  createDrawerSchema,
  createExpenseSchema,
  createLedgerAccountSchema,
  openDrawerSchema,
  propertyQuerySchema,
  settleLedgerSchema,
  type ChargeToLedgerDto,
  type CloseDrawerDto,
  type CreateBusinessSourceDto,
  type CreateDrawerDto,
  type CreateExpenseDto,
  type CreateLedgerAccountDto,
  type OpenDrawerDto,
  type PropertyQueryDto,
  type SettleLedgerDto,
} from './dto';
import type { AuthPrincipal } from '../auth/dto';

/** The cashier's desk: city ledger, tills, expenses. Pro and above. */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard)
@Feature('cashiering')
export class CashieringController {
  constructor(private readonly cash: CashieringService) {}

  // --- City ledger ---
  @Get('ledger-accounts')
  listAccounts(@TenantId() tenantId: string) {
    return this.cash.listAccounts(tenantId);
  }

  @Post('ledger-accounts')
  @HttpCode(201)
  createAccount(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createLedgerAccountSchema)) dto: CreateLedgerAccountDto,
  ) {
    return this.cash.createAccount(tenantId, dto);
  }

  @Get('ledger-accounts/:id/statement')
  statement(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cash.statement(tenantId, id);
  }

  /** The account pays us — a credit against its balance. */
  @Post('ledger-accounts/:id/settle')
  @HttpCode(201)
  settle(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settleLedgerSchema)) dto: SettleLedgerDto,
  ) {
    return this.cash.settleLedger(tenantId, id, user.sub, dto);
  }

  /** "Charge to company": clears the folio and moves the debt to the account. */
  @Post('folios/:id/charge-to-ledger')
  @HttpCode(201)
  chargeToLedger(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chargeToLedgerSchema)) dto: ChargeToLedgerDto,
  ) {
    return this.cash.chargeToLedger(tenantId, id, user.sub, dto);
  }

  // --- Business sources ---
  @Get('business-sources')
  listSources(@TenantId() tenantId: string) {
    return this.cash.listBusinessSources(tenantId);
  }

  @Post('business-sources')
  @HttpCode(201)
  createSource(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createBusinessSourceSchema)) dto: CreateBusinessSourceDto,
  ) {
    return this.cash.createBusinessSource(tenantId, dto);
  }

  // --- Drawers ---
  @Get('properties/:propertyId/drawers')
  listDrawers(@TenantId() tenantId: string, @Param('propertyId') propertyId: string) {
    return this.cash.listDrawers(tenantId, propertyId);
  }

  @Post('properties/:propertyId/drawers')
  @HttpCode(201)
  createDrawer(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createDrawerSchema)) dto: CreateDrawerDto,
  ) {
    return this.cash.createDrawer(tenantId, propertyId, dto);
  }

  @Post('drawers/:id/open')
  @HttpCode(201)
  open(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(openDrawerSchema)) dto: OpenDrawerDto,
  ) {
    return this.cash.openSession(tenantId, id, user.sub, dto);
  }

  /** The Cashier Report — live while the shift is open, frozen once closed. */
  @Get('drawer-sessions/:id/report')
  report(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cash.report(tenantId, id);
  }

  @Post('drawer-sessions/:id/close')
  @HttpCode(200)
  close(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeDrawerSchema)) dto: CloseDrawerDto,
  ) {
    return this.cash.closeSession(tenantId, id, user.sub, dto);
  }

  // --- Expenses ---
  @Get('expenses')
  listExpenses(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(propertyQuerySchema)) q: PropertyQueryDto,
  ) {
    return this.cash.listExpenses(tenantId, q.propertyId);
  }

  @Post('properties/:propertyId/expenses')
  @HttpCode(201)
  createExpense(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(createExpenseSchema)) dto: CreateExpenseDto,
  ) {
    return this.cash.createExpense(tenantId, propertyId, user.sub, dto);
  }
}
