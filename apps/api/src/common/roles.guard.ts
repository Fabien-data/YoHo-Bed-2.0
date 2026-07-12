import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '../auth/dto';
import { ROLES_KEY } from './roles.decorator';

/** Allows the request only if the authenticated user holds one of the required roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    if (!req.user) throw new UnauthorizedException();

    const held = new Set(req.user.memberships.map((m) => m.role));
    if (!required.some((r) => held.has(r))) {
      throw new ForbiddenException('Requires a staff role');
    }
    return true;
  }
}
