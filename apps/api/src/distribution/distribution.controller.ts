import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { DistributionService } from './distribution.service';

@Controller('distribution')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  @Get('health')
  health(@TenantId() tenantId: string) {
    return this.distribution.health(tenantId);
  }

  @Post('test-failure')
  @HttpCode(202)
  testFailure(@TenantId() tenantId: string) {
    return this.distribution.triggerTestFailure(tenantId);
  }
}
