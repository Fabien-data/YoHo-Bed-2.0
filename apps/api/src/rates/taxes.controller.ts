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
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { TenantRoleGuard, TenantRoles } from '../common/tenant-role';
import { TaxesService } from './taxes.service';

const uuid = new ParseUUIDPipe();

const taxFields = {
  name: z.string().trim().min(1).max(60),
  code: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9-]*$/, 'letters, digits and - only')
    .nullable(),
  ratePercent: z.number().min(0).max(100),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  exemptible: z.boolean(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
};
const createTaxSchema = z
  .object({
    ...taxFields,
    code: taxFields.code.optional(),
    exemptible: taxFields.exemptible.optional(),
    from: taxFields.from.optional(),
  })
  .strict();
const updateTaxSchema = z.object(taxFields).partial().strict();

/** Setup → Taxes & levies (Development Phase 02, Sprint 7). Reading is open; changing is the owner's. */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, TenantRoleGuard)
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get('properties/:id/taxes')
  overview(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.taxes.overview(tenantId, id);
  }

  @Post('properties/:id/taxes')
  @HttpCode(201)
  @TenantRoles('OWNER')
  createTax(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createTaxSchema)) dto: z.infer<typeof createTaxSchema>,
  ) {
    return this.taxes.createTax(tenantId, id, dto);
  }

  @Patch('properties/:id/taxes/:taxTypeId')
  @TenantRoles('OWNER')
  updateTax(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Param('taxTypeId', uuid) taxTypeId: string,
    @Body(new ZodValidationPipe(updateTaxSchema)) dto: z.infer<typeof updateTaxSchema>,
  ) {
    return this.taxes.updateTax(tenantId, id, taxTypeId, dto);
  }

  @Delete('properties/:id/taxes/:taxTypeId')
  @TenantRoles('OWNER')
  removeTax(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Param('taxTypeId', uuid) taxTypeId: string,
  ) {
    return this.taxes.removeTax(tenantId, id, taxTypeId);
  }

  @Post('properties/:id/taxes/apply-preset')
  @HttpCode(200)
  @TenantRoles('OWNER')
  applyPreset(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.taxes.applyPreset(tenantId, id);
  }
}
