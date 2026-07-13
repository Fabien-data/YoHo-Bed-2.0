import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/**
 * Authenticates the channel manager's webhook calls with a shared secret header — there is no
 * user JWT on this path. Rotate via the CM_WEBHOOK_SECRET env var.
 */
@Injectable()
export class CmSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    if (req.headers['x-cm-secret'] !== this.config.get('CM_WEBHOOK_SECRET', { infer: true })) {
      throw new UnauthorizedException('Invalid CM webhook secret');
    }
    return true;
  }
}
