import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { InvoicesService } from './invoices.service';
import { MailerService } from '../email/mailer.service';
import { renderInvoicePdf } from '../vouchers/document-pdf';
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
const sendInvoiceSchema = z.object({ emails: z.array(z.string().trim().email()).min(1).max(10) });

/**
 * Invoices, pro-formas, credit notes and the document series (Development Phase 02, Sprint 6).
 * Every plan: a hotel without the folio screen still has to invoice its guests.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly mailer: MailerService,
  ) {}

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

  @Get('invoices/:id/pdf')
  async pdf(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Res() res: Response) {
    const invoice = await this.invoices.detail(tenantId, id);
    const pdf = await renderInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  @Post('invoices/:id/send')
  @HttpCode(201)
  async send(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(sendInvoiceSchema)) dto: z.infer<typeof sendInvoiceSchema>,
  ) {
    const result = await this.invoices.queueEmail(tenantId, id, dto.emails);
    this.mailer.deliverQueuedSafe(tenantId);
    return result;
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
