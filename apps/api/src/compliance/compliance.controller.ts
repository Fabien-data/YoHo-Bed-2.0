import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/dto';
import { ComplianceService } from './compliance.service';
import {
  formCSubmitSchema,
  registrationSchema,
  type FormCSubmitDto,
  type RegistrationDto,
} from './dto';

const uuid = new ParseUUIDPipe();

/**
 * Registering guests with the authorities (Development Phase 02, Sprint 7): a stay's journey
 * details, India's Form C filings and the tracker that keeps them inside 24 hours.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('bookings/:id/registration')
  registration(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.compliance.registration(tenantId, id);
  }

  @Put('bookings/:id/registration')
  saveRegistration(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(registrationSchema)) dto: RegistrationDto,
  ) {
    return this.compliance.saveRegistration(tenantId, id, dto);
  }

  @Post('bookings/:id/form-c')
  submitFormC(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(formCSubmitSchema)) dto: FormCSubmitDto,
  ) {
    return this.compliance.submitFormC(tenantId, id, dto, user.sub);
  }

  @Get('properties/:propertyId/form-c')
  formC(@TenantId() tenantId: string, @Param('propertyId', uuid) propertyId: string) {
    return this.compliance.formCTracker(tenantId, propertyId);
  }
}
