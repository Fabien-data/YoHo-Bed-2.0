import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDb, withTenant, type Database, type DbHandle, type Tx } from '@yohobed/db';
import type { Env } from '../config/env';

/**
 * Owns the app's database connection. The app connects as the restricted `yoho_app` role, so
 * Postgres RLS is always in force — a query that forgets its tenant filter still cannot leak
 * another tenant's rows.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly handle: DbHandle;

  constructor(config: ConfigService<Env, true>) {
    this.handle = createDb(config.get('APP_DATABASE_URL', { infer: true }));
  }

  /** Unscoped handle — for global reads only (users/memberships during auth). */
  get db(): Database {
    return this.handle.db;
  }

  /** Run work fenced to a single tenant (sets app.tenant_id for RLS within a transaction). */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.handle.db, tenantId, fn);
  }

  onModuleDestroy(): Promise<void> {
    return this.handle.close();
  }
}
