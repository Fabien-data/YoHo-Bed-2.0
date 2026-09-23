import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SearchService } from './search.service';
import { searchQuerySchema, type SearchQueryDto } from './dto';

/** The desk's one search (UX-2). Ungated and open to every role: finding a stay is not a feature. */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  find(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(searchQuerySchema)) q: SearchQueryDto,
  ) {
    return this.search.search(tenantId, q);
  }
}
