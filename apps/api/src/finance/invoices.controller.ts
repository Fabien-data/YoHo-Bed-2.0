import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { InvoicesService } from './invoices.service';
import {
  creditNoteSchema,
  issueInvoiceSchema,
  listInvoicesQuerySchema,
  proformaSchema,
  updateSequenceSchema,
  type CreditNoteDto,
  type IssueInvoiceDto,
  type ListInvoicesQuery,
  type ProformaDto,
  type UpdateSequenceDto,
} from './dto';

const uuid = new ParseUUIDPipe();
const noBody = new ZodValidationPipe(issueInvoiceSchema);

/**
 * Invoices, pro-formas, credit notes and the document series (Development Phase 02, Sprint 6).
 * Every plan: a hotel without the folio screen still has to invoice its guests.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('folios/:id/invoice')
  @HttpCode(201)
  issueForFolio(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(noBody) dto: IssueInvoiceDto,
  ) {
    return this.invoices.issueForFolio({ tenantId, userId: user.sub }, id, dto);
  }

  /** Invoice a booking's own bill (window 1), opening it if the stay never had one. */
  @Post('bookings/:id/invoices')
  @HttpCode(201)
  issueForBooking(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(noBody) dto: IssueInvoiceDto,
  ) {
    return this.invoices.issueForBooking({ tenantId, userId: user.sub }, id, dto);
  }

  @Post('bookings/:id/proforma')
  @HttpCode(201)
  proforma(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(proformaSchema)) dto: ProformaDto,
  ) {
    return this.invoices.proforma({ tenantId, userId: user.sub }, id, dto);
  }

  @Post('invoices/:id/credit-note')
  @HttpCode(201)
  creditNote(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(creditNoteSchema)) dto: CreditNoteDto,
  ) {
    return this.invoices.creditNote({ tenantId, userId: user.sub }, id, dto);
  }

  @Get('invoices')
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) q: ListInvoicesQuery,
  ) {
    return this.invoices.list(tenantId, q);
  }

  @Get('invoices/:id')
  detail(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.invoices.detail(tenantId, id);
  }

  @Get('properties/:id/document-sequences')
  sequences(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.invoices.sequences(tenantId, id);
  }

  @Patch('properties/:id/document-sequences')
  @TenantRoles('OWNER')
  setSequence(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateSequenceSchema)) dto: UpdateSequenceDto,
  ) {
    return this.invoices.setSequence(tenantId, id, dto);
  }
}
