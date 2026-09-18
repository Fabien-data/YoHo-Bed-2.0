import {
  Body,
  Controller,
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
import { TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { Feature } from '../common/feature.decorator';
import { EntitlementGuard } from '../common/entitlement.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContractRatesService } from './contract-rates.service';
import {
  createContractRateSchema,
  updateContractRateSchema,
  type CreateContractRateDto,
  type UpdateContractRateDto,
} from './dto';

const uuid = new ParseUUIDPipe();

/**
 * A travel agent's or company's contract rates — Yanolja's "Rate Offered: Contract". Part of the
 * city ledger, so Pro and above; setting a rate is price authority, so owners only.
 */
@Controller('ledger-accounts/:accountId/rates')
@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard, TenantRoleGuard)
@Feature('cashiering')
export class ContractRatesController {
  constructor(private readonly contracts: ContractRatesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Param('accountId', uuid) accountId: string) {
    return this.contracts.list(tenantId, accountId);
  }

  @Post()
  @HttpCode(201)
  @TenantRoles('OWNER')
  create(
    @TenantId() tenantId: string,
    @Param('accountId', uuid) accountId: string,
    @Body(new ZodValidationPipe(createContractRateSchema)) dto: CreateContractRateDto,
  ) {
    return this.contracts.create(tenantId, accountId, dto);
  }

  @Patch(':rateId')
  @TenantRoles('OWNER')
  update(
    @TenantId() tenantId: string,
    @Param('accountId', uuid) accountId: string,
    @Param('rateId', uuid) rateId: string,
    @Body(new ZodValidationPipe(updateContractRateSchema)) dto: UpdateContractRateDto,
  ) {
    return this.contracts.update(tenantId, accountId, rateId, dto);
  }
}
