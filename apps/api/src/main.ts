import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  // Allow the local web-extranet (and other dev origins) to call the API from the browser.
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Idempotency-Key makes a retried POST /reservations safe; without it here the browser's
    // preflight refuses the request before it is ever sent.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'Idempotency-Key'],
    // X-Request-Id is the reference an error shows the desk; the browser can't read it otherwise.
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'],
  });

  // nginx on the same host proxies every request, so without this `@Ip()` records 127.0.0.1 —
  // the night-audit log's "from where" was the proxy, never the person. Trust loopback only.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);
  Logger.log(`YoHoBed API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
