import { describe, it, expect } from 'vitest';
import { ratesToLkrFromErApi, fetchRatesToLkr, DEFAULT_FX_URL } from '../src/fx';

describe('ratesToLkrFromErApi', () => {
  const good = {
    result: 'success',
    base_code: 'LKR',
    // foreign units per 1 LKR (so 1 USD ≈ 303 LKR, 1 GBP ≈ 385 LKR, etc.)
    rates: { LKR: 1, USD: 0.0033, INR: 0.28, GBP: 0.0026, EUR: 0.003 },
  };

  it('inverts foreign-per-LKR into "1 base = N LKR" for every tracked non-LKR currency', () => {
    const rows = ratesToLkrFromErApi(good);
    const byBase = Object.fromEntries(rows.map((r) => [r.base, r]));
    // one row each for USD/INR/GBP/EUR, never LKR (the pivot)
    expect(rows.map((r) => r.base).sort()).toEqual(['EUR', 'GBP', 'INR', 'USD']);
    expect(byBase.USD.rate).toBeCloseTo(1 / 0.0033, 6);
    expect(byBase.GBP.rate).toBeCloseTo(1 / 0.0026, 6);
    expect(rows.every((r) => r.source === 'auto')).toBe(true);
  });

  it('rejects a non-success or wrong-base response instead of storing garbage', () => {
    expect(() => ratesToLkrFromErApi({ result: 'error', base_code: 'LKR', rates: {} })).toThrow();
    expect(() =>
      ratesToLkrFromErApi({ result: 'success', base_code: 'USD', rates: { LKR: 300 } }),
    ).toThrow();
  });

  it('throws if a tracked currency rate is missing or non-positive (never a silent zero)', () => {
    expect(() =>
      ratesToLkrFromErApi({ result: 'success', base_code: 'LKR', rates: { USD: 0.0033 } }),
    ).toThrow(/INR/);
    expect(() =>
      ratesToLkrFromErApi({
        result: 'success',
        base_code: 'LKR',
        rates: { USD: 0.0033, INR: 0, GBP: 0.0026, EUR: 0.003 },
      }),
    ).toThrow(/INR/);
  });
});

describe('fetchRatesToLkr', () => {
  it('calls the default provider URL and parses the payload via an injected fetch', async () => {
    let calledUrl = '';
    const fakeFetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: 'success',
          base_code: 'LKR',
          rates: { LKR: 1, USD: 0.0033, INR: 0.28, GBP: 0.0026, EUR: 0.003 },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const rows = await fetchRatesToLkr({ fetchImpl: fakeFetch });
    expect(calledUrl).toBe(DEFAULT_FX_URL);
    expect(rows).toHaveLength(4);
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = (async () =>
      ({ ok: false, status: 503, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(fetchRatesToLkr({ fetchImpl: fakeFetch })).rejects.toThrow(/503/);
  });
});
