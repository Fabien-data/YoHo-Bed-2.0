'use client';

/**
 * Display-currency system. Like the theme toggle, the chosen currency is a global user preference
 * persisted in localStorage. Unlike theme it must be reactive (amounts re-render on change), so it
 * lives in React context.
 *
 * Model: every amount is stored in its property's BASE currency (LKR or USD). The picker lets a
 * user *view* everything in any supported currency (LKR/USD/INR/GBP/EUR); when the display currency
 * differs from an amount's source, `useMoney()` converts it at the current FX rate and marks the
 * result approximate with a leading "≈". Native amounts are shown exactly, with no marker.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  CURRENCY_META,
  SUPPORTED_CURRENCIES,
  convert,
  isCurrencyCode,
  type CurrencyCode,
  type RatesToLkr,
} from '@yohobed/domain';
import { getFxRates } from '@/lib/api';
import { money as fmtMoney, moneyShort as fmtMoneyShort } from '@/lib/format';

const DISPLAY_KEY = 'yhb_display_ccy';

interface CurrencyCtx {
  display: CurrencyCode;
  setDisplay: (c: CurrencyCode) => void;
  /** LKR-pivot snapshot { LKR:1, USD:302.5, … }, or null until rates load. */
  rates: RatesToLkr | null;
}
const Ctx = createContext<CurrencyCtx | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [display, setDisplayState] = useState<CurrencyCode>('LKR');
  const [rates, setRates] = useState<RatesToLkr | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISPLAY_KEY);
      if (stored && isCurrencyCode(stored)) setDisplayState(stored);
    } catch {
      // storage unavailable — default to LKR
    }
    getFxRates()
      .then((res) => {
        const map: Record<string, number> = { LKR: 1 };
        for (const r of res.rates) if (r.rate != null) map[r.base] = r.rate;
        setRates(map as RatesToLkr);
      })
      .catch(() => setRates({ LKR: 1 } as RatesToLkr));
  }, []);

  const setDisplay = (c: CurrencyCode) => {
    setDisplayState(c);
    try {
      localStorage.setItem(DISPLAY_KEY, c);
    } catch {
      // choice just won't persist
    }
  };

  const value = useMemo(() => ({ display, setDisplay, rates }), [display, rates]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDisplayCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDisplayCurrency must be used within CurrencyProvider');
  return ctx;
}

/**
 * Conversion-aware money formatters. Call `money(amount, sourceCurrency)` — the source defaults to
 * LKR for legacy/unknown values. The chosen display currency and live rates are pulled from context.
 *
 * `approximate` marks a figure the SERVER already consolidated across currencies (any aggregate
 * whose response carries `approximate: true`). Without it such a total would render as an exact
 * native amount — the conversion happened server-side, so this layer has no way to detect it — and
 * a rupee-consolidated multi-currency total would masquerade as precise.
 */
export function useMoney() {
  const { display, rates } = useDisplayCurrency();

  function fmt(
    short: boolean,
    v?: string | number | null,
    source: string = 'LKR',
    approximate = false,
  ): string {
    const src: CurrencyCode = isCurrencyCode(source) ? source : 'LKR';
    const base = short ? fmtMoneyShort : fmtMoney;
    const mark = (s: string) => (approximate ? '≈ ' + s : s);
    if (display === src || !rates) return mark(base(v, src));
    if (v === undefined || v === null || v === '') return mark(base(v, src));
    const n = typeof v === 'string' ? Number(v) : v;
    if (Number.isNaN(n)) return mark(base(v, src));
    try {
      return '≈ ' + base(convert(n, src, display, rates), display);
    } catch {
      // Missing rate for this pair — show the exact native amount rather than a broken value.
      return mark(base(v, src));
    }
  }

  return {
    money: (v?: string | number | null, source?: string, approximate?: boolean) =>
      fmt(false, v, source, approximate),
    moneyShort: (v?: string | number | null, source?: string, approximate?: boolean) =>
      fmt(true, v, source, approximate),
    display,
  };
}

/** The sidebar dropdown that sets the global display currency. */
export function CurrencyPicker() {
  const { display, setDisplay } = useDisplayCurrency();
  const approx = display !== 'LKR';
  return (
    <select
      value={display}
      onChange={(e) => setDisplay(e.target.value as CurrencyCode)}
      aria-label="Display currency"
      title={
        approx
          ? 'Amounts not already in this currency are converted at the latest rate (approximate).'
          : 'Choose the currency to view amounts in'
      }
      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm font-semibold text-ink-2 transition duration-1 hover:border-ink-3 hover:text-ink focus-visible:border-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-soft"
    >
      {SUPPORTED_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {CURRENCY_META[c].symbol} {c}
        </option>
      ))}
    </select>
  );
}
