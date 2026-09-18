import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { CurrentTenantRole, TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { EntitlementGuard } from '../common/entitlement.guard';
import { Feature } from '../common/feature.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import type { Actor } from './reservation.service';
import { BookingExtrasService } from './booking-extras.service';
import { StayServicesService } from './stay-services.service';
import {
  addBookingGuestSchema,
  createDocumentSchema,
  createInclusionSchema,
  createRemarkSchema,
  createTaskSchema,
  createTransferSchema,
  transportModeSchema,
  updateDocumentSchema,
  updateTransferSchema,
  updateTransportModeSchema,
  type AddBookingGuestDto,
  type CreateDocumentDto,
  type CreateInclusionDto,
  type CreateRemarkDto,
  type CreateTaskDto,
  type CreateTransferDto,
  type TransportModeDto,
  type UpdateDocumentDto,
  type UpdateTransferDto,
  type UpdateTransportModeDto,
} from './dto';

const uuid = new ParseUUIDPipe();

function actorOf(tenantId: string, user: AuthPrincipal, role: string | undefined): Actor {
  return { tenantId, userId: user.sub, role };
}

/**
 * A booking's guests, remarks and tasks, and a guest's identity documents (Development Phase 02,
 * Sprint 4). Every plan, except tasks: those are work orders, which are Pro.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard, EntitlementGuard)
export class BookingExtrasController {
  constructor(
    private readonly extras: BookingExtrasService,
    private readonly stay: StayServicesService,
  ) {}

  // --- Inclusions and transfers (Sprint 5) ---

  @Get('bookings/:id/inclusions')
  inclusions(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.stay.inclusions(tenantId, id);
  }

  @Post('bookings/:id/inclusions')
  @HttpCode(201)
  addInclusion(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createInclusionSchema)) dto: CreateInclusionDto,
  ) {
    return this.stay.addInclusion(actorOf(tenantId, user, role), id, dto);
  }

  @Delete('booking-inclusions/:id')
  removeInclusion(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.stay.removeInclusion(tenantId, id);
  }

  @Get('bookings/:id/transfers')
  transfers(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.stay.transfers(tenantId, id);
  }

  @Post('bookings/:id/transfers')
  @HttpCode(201)
  addTransfer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createTransferSchema)) dto: CreateTransferDto,
  ) {
    return this.stay.addTransfer(actorOf(tenantId, user, role), id, dto);
  }

  @Patch('booking-transfers/:id')
  updateTransfer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateTransferSchema)) dto: UpdateTransferDto,
  ) {
    return this.stay.updateTransfer(actorOf(tenantId, user, role), id, dto);
  }

  @Get('transport-modes')
  transportModes(@TenantId() tenantId: string) {
    return this.stay.modes(tenantId);
  }

  @Post('transport-modes')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createTransportMode(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(transportModeSchema)) dto: TransportModeDto,
  ) {
    return this.stay.createMode(tenantId, dto);
  }

  @Patch('transport-modes/:id')
  @TenantRoles('OWNER')
  updateTransportMode(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateTransportModeSchema)) dto: UpdateTransportModeDto,
  ) {
    return this.stay.updateMode(tenantId, id, dto);
  }

  // --- Remarks ---

  @Get('bookings/:id/remarks')
  remarks(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.extras.remarks(tenantId, id);
  }

  @Post('bookings/:id/remarks')
  @HttpCode(201)
  addRemark(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createRemarkSchema)) dto: CreateRemarkDto,
  ) {
    return this.extras.addRemark(actorOf(tenantId, user, role), id, dto);
  }

  @Delete('booking-remarks/:id')
  deleteRemark(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
  ) {
    return this.extras.deleteRemark(actorOf(tenantId, user, role), id);
  }

  // --- Guests in the room ---

  @Get('bookings/:id/guests')
  guests(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.extras.guests(tenantId, id);
  }

  @Post('bookings/:id/guests')
  @HttpCode(201)
  addGuest(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(addBookingGuestSchema)) dto: AddBookingGuestDto,
  ) {
    return this.extras.addGuest(actorOf(tenantId, user, role), id, dto);
  }

  @Delete('bookings/:id/guests/:customerId')
  removeGuest(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Param('customerId', uuid) customerId: string,
  ) {
    return this.extras.removeGuest(tenantId, id, customerId);
  }

  // --- Tasks (Pro) ---

  @Get('bookings/:id/tasks')
  @Feature('work_orders')
  tasks(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.extras.tasks(tenantId, id);
  }

  @Post('bookings/:id/tasks')
  @HttpCode(201)
  @Feature('work_orders')
  addTask(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createTaskSchema)) dto: CreateTaskDto,
  ) {
    return this.extras.addTask(actorOf(tenantId, user, role), id, dto);
  }

  // --- Identity documents ---

  @Get('customers/:id/documents')
  documents(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.extras.documents(tenantId, id);
  }

  @Post('customers/:id/documents')
  @HttpCode(201)
  addDocument(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createDocumentSchema)) dto: CreateDocumentDto,
  ) {
    return this.extras.addDocument(actorOf(tenantId, user, role), id, dto);
  }

  @Patch('guest-documents/:id')
  updateDocument(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @CurrentTenantRole() role: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) dto: UpdateDocumentDto,
  ) {
    return this.extras.updateDocument(actorOf(tenantId, user, role), id, dto);
  }

  @Delete('guest-documents/:id')
  deleteDocument(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.extras.deleteDocument(tenantId, id);
  }
}
