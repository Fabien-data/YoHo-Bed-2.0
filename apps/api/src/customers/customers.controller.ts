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
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CustomersService } from './customers.service';
import {
  createCustomerSchema,
  searchCustomersSchema,
  updateCustomerSchema,
  type CreateCustomerDto,
  type SearchCustomersDto,
  type UpdateCustomerDto,
} from './dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, TenantGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.customersService.list(tenantId);
  }

  /** Declared before `:id`, which would otherwise swallow the word "search" as an id. */
  @Get('search')
  search(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(searchCustomersSchema)) q: SearchCustomersDto,
  ) {
    return this.customersService.search(tenantId, q);
  }

  @Post()
  @HttpCode(201)
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerDto,
  ) {
    return this.customersService.create(tenantId, dto);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.customersService.get(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(tenantId, id, dto);
  }
}
