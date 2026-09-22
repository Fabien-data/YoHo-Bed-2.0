import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithId = Request & { requestId?: string };

/** A caller-supplied id is kept only if it looks like one of ours or a proxy's. */
const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * A short reference for every request (UX-0), sent back as `X-Request-Id`. It is what the desk
 * reads out to support — "reference R-7fK2mQ9a" — and what we grep the logs for, so a hotel's
 * "it said something went wrong" becomes one log line instead of a guess.
 */
export function newRequestId(): string {
  return `R-${randomBytes(6).toString('base64url')}`;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : newRequestId();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}

/**
 * Puts the request reference beside every unexpected failure. Nest's base filter still writes the
 * response (bodies are unchanged) and logs the stack; this adds the line that ties the stack to
 * the reference the user saw. Expected errors (4xx, deliberate 503s) are not logged.
 */
@Catch()
export class RequestErrorFilter extends BaseExceptionFilter {
  private readonly log = new Logger('RequestError');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException) && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<RequestWithId>();
      this.log.error(`${req.requestId ?? '-'} ${req.method} ${req.originalUrl ?? req.url} failed`);
    }
    super.catch(exception, host);
  }
}
