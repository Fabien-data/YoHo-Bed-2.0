import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard, type TenantRequest } from '../tenancy/tenant.guard';

@Controller('hotel-access')
@UseGuards(JwtAuthGuard, TenantGuard)
export class HotelAccessController {
  @Get()
  current(@Req() request: TenantRequest) {
    return {
      role: request.role,
      permissions: request.hotelPermissions ?? null,
      propertyIds: request.grantedPropertyIds ?? null,
    };
  }
}
