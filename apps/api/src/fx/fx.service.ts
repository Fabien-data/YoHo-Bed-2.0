import { Injectable } from '@nestjs/common';
import {
  auditLog,
  latestRates,
  latestRatesToLkr,
  listRateHistory,
  insertExchangeRates,
} from '@yohobed/db';
import { CURRENCY_META, SUPPORTED_CURRENCIES } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import type { AuthPrincipal } from '../auth/dto';
import type { FxOverrideDto } from './dto';

@Injectable()
export class FxService {
  constructor(private readonly dbs: DatabaseService) {}

  /**
   * Current rates for the display picker: the newest "1 base = N LKR" per currency, plus LKR itself
   * (always 1) so the frontend has a complete, self-describing table. Global data — no tenant scope.
   */
  async current() {
    const rows = await latestRates(this.dbs.db);
    const byBase = new Map(rows.map((r) => [r.base, r]));
    const rates = SUPPORTED_CURRENCIES.map((code) => {
      const meta = CURRENCY_META[code];
      if (code === 'LKR') {
        return { base: 'LKR', rate: 1, source: 'pivot', fetchedAt: null, symbol: meta.symbol };
      }
      const row = byBase.get(code);
      return {
        base: code,
        rate: row?.rate ?? null,
        source: row?.source ?? null,
        fetchedAt: row?.fetchedAt ?? null,
        symbol: meta.symbol,
      };
    });
    return { quote: 'LKR', rates };
  }

  /** The bare LKR-pivot snapshot map { LKR:1, USD:302.5, ... } for server-side conversion callers. */
  snapshot() {
    return latestRatesToLkr(this.dbs.db);
  }

  /** Rate history (newest first), optionally for one currency — powers the staff audit view. */
  history(base?: string, limit?: number) {
    return listRateHistory(this.dbs.db, { base, limit });
  }

  /** Staff manual override: append a 'manual' rate row and record it in the audit log. */
  async override(actor: AuthPrincipal, dto: FxOverrideDto) {
    await insertExchangeRates(this.dbs.db, [{ base: dto.base, rate: dto.rate, source: 'manual' }]);
    await this.dbs.db.insert(auditLog).values({
      tenantId: null,
      actorUserId: actor.sub,
      actorEmail: actor.email,
      action: 'fx.override',
      entity: 'fx_rate',
      entityId: dto.base,
      detail: { rate: dto.rate, note: dto.note } as never,
    });
    return { base: dto.base, rate: dto.rate, quote: 'LKR', source: 'manual' };
  }
}
