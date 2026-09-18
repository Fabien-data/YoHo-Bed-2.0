import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReservationsService } from './reservations.service';
import {
  makeGroupSchema,
  mergeGroupSchema,
  mergeGroupsSchema,
  reservationExportSchema,
  reservationGroupQuerySchema,
  reservationQuerySchema,
  type MakeGroupDto,
  type MergeGroupDto,
  type MergeGroupsDto,
  type ReservationExportDto,
  type ReservationGroupQueryDto,
  type ReservationQueryDto,
} from './dto';

@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** The Reservations screen: one tab's rows plus every tab's live count. */
  @Get('reservations')
  search(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(reservationQuerySchema)) q: ReservationQueryDto,
  ) {
    return this.reservations.search(tenantId, q);
  }

  /** Every row of a tab as CSV, with the list's filters — not just the page on screen. */
  @Get('reservations/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async export(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(reservationExportSchema)) q: ReservationExportDto,
  ) {
    return this.reservations.exportCsv(tenantId, q);
  }

  /** Yanolja's group view: one card per group, its rooms added up. */
  @Get('reservation-groups')
  groups(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(reservationGroupQuerySchema)) q: ReservationGroupQueryDto,
  ) {
    return this.reservations.groups(tenantId, q);
  }

  /** Merge whole groups into one; the kept group's owner stays the owner. */
  @Post('reservation-groups/merge')
  @HttpCode(200)
  mergeGroups(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(mergeGroupsSchema)) dto: MergeGroupsDto,
  ) {
    return this.reservations.mergeGroups(tenantId, dto);
  }

  /** Everything a printed registration card needs — Yanolja's "Print GR". */
  @Get('bookings/:id/registration-card')
  registrationCard(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.registrationCard(tenantId, id);
  }

  @Post('properties/:propertyId/booking-groups')
  @HttpCode(201)
  makeGroup(
    @TenantId() tenantId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(makeGroupSchema)) dto: MakeGroupDto,
  ) {
    return this.reservations.makeGroup(tenantId, propertyId, dto);
  }

  @Get('booking-groups/:id')
  group(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.group(tenantId, id);
  }

  @Post('booking-groups/:id/merge')
  @HttpCode(200)
  merge(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mergeGroupSchema)) dto: MergeGroupDto,
  ) {
    return this.reservations.mergeIntoGroup(tenantId, id, dto.bookingIds);
  }

  @Delete('bookings/:id/group')
  leaveGroup(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.leaveGroup(tenantId, id);
  }
}
