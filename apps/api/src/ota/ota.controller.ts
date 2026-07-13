import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CmSecretGuard } from './cm-secret.guard';
import { OtaService } from './ota.service';
import {
  cmReservationSchema,
  setMappingSchema,
  simulateSchema,
  type CmReservationDto,
  type SetMappingDto,
  type SimulateDto,
} from './dto';

@Controller()
export class OtaController {
  constructor(private readonly ota: OtaService) {}

  /** Channel-manager webhook — shared-secret auth, no user JWT on this path. */
  @Post('cm/reservations')
  @UseGuards(CmSecretGuard)
  @HttpCode(200)
  ingest(@Body(new ZodValidationPipe(cmReservationSchema)) dto: CmReservationDto) {
    return this.ota.ingest(dto);
  }

  // --- Owner inbox -------------------------------------------------------------

  @Get('ota/reservations')
  @UseGuards(JwtAuthGuard, TenantGuard)
  list(@TenantId() tenantId: string) {
    return this.ota.list(tenantId);
  }

  @Post('ota/reservations/:id/retry')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @HttpCode(200)
  retry(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ota.retry(tenantId, id);
  }

  @Get('ota/mappings')
  @UseGuards(JwtAuthGuard, TenantGuard)
  listMappings(@TenantId() tenantId: string) {
    return this.ota.listMappings(tenantId);
  }

  @Put('ota/mappings')
  @UseGuards(JwtAuthGuard, TenantGuard)
  setMapping(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(setMappingSchema)) dto: SetMappingDto,
  ) {
    return this.ota.setMapping(tenantId, dto);
  }

  @Post('ota/simulate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @HttpCode(200)
  simulate(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(simulateSchema)) dto: SimulateDto,
  ) {
    return this.ota.simulate(tenantId, dto);
  }
}
