import { SUPPORTED_CURRENCIES } from '@yohobed/domain';
import { insertExchangeRates, type Database, type ExchangeRateInput } from '@yohobed/db';

/**
 * FX rate fetcher (Phase 2 of multi-currency).
 *
 * Provider: the open ExchangeRate-API endpoint (open.er-api.com) — free, no API key, and unlike
 * ECB/Frankfurter it publishes LKR, which is our pivot currency. We query base=LKR once and invert:
 * the response gives "foreign units per 1 LKR", and we store the reciprocal ("1 foreign = N LKR")
 * to match the exchange_rates convention (quote always LKR).
 *
 * The pure parser (`ratesToLkrFromErApi`) is separated from the network call so it is unit-testable
 * without a live provider. `fetchRatesToLkr` accepts an injectable `fetchImpl` for the same reason
 * (mirrors packages/cm-adapter/src/axisrooms.ts).
 */

export const DEFAULT_FX_URL = 'https://open.er-api.com/v6/latest/LKR';

export interface ErApiResponse {
  result?: string;
  base_code?: string;
  /** currency code -> units of that currency per 1 LKR */
  rates?: Record<string, number>;
}

/** Convert an open.er-api.com base=LKR response into "1 base = N LKR" rows for our tracked currencies. */
export function ratesToLkrFromErApi(json: ErApiResponse): ExchangeRateInput[] {
  if (json.result !== 'success' || json.base_code !== 'LKR' || !json.rates) {
    throw new Error(
      `Unexpected FX provider response (result=${json.result}, base=${json.base_code})`,
    );
  }
  const out: ExchangeRateInput[] = [];
  for (const code of SUPPORTED_CURRENCIES) {
    if (code === 'LKR') continue; // pivot: implicitly 1, never stored
    const perLkr = json.rates[code];
    if (!perLkr || perLkr <= 0 || !Number.isFinite(perLkr)) {
      throw new Error(`Missing/invalid FX rate for ${code} (perLkr=${perLkr})`);
    }
    out.push({ base: code, rate: 1 / perLkr, source: 'auto' });
  }
  return out;
}

export async function fetchRatesToLkr(
  opts: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ExchangeRateInput[]> {
  const url = opts.url ?? DEFAULT_FX_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`FX provider returned ${res.status}`);
    const json = (await res.json()) as ErApiResponse;
    return ratesToLkrFromErApi(json);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('FX provider timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch current rates and append them (source 'auto'). Logs and swallows errors — never crashes the worker. */
export async function fetchAndStoreRates(
  db: Database,
  opts: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  try {
    const rows = await fetchRatesToLkr(opts);
    await insertExchangeRates(db, rows);
    console.log(
      `[fx] stored ${rows.length} rate(s): ` +
        rows.map((r) => `${r.base}=${r.rate.toFixed(4)}`).join(' '),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[fx] rate refresh failed (keeping last known rates): ${msg}`);
  }
}
