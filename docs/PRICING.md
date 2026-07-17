# YoHoBed 2.0 — The Pricing & Settlement Engine

> How every rupee is computed. `packages/domain` is a framework-free reproduction of the legacy
> PHP formulas — **numeric parity is the contract**, proven by 42 unit tests that mirror legacy
> IEEE-754 float behavior on purpose. Selling prices are always _derived_ by this engine; nobody
> ever types a selling price by hand.
>
> Companion docs: [DATA-MODEL.md](DATA-MODEL.md) (where the numbers are stored) ·
> [API.md](API.md) (the endpoints that trigger them)

## 1. The price of a night

```
base price  (what the owner types)
   │
   ├─▶ + Yoho commission            slab lookup, or roundUp(base ÷ (1 − pct/100) − base)
   │
   ├─▶ ÷ (1 − OTA/100)              OTA gross-up; OTA rate = 18 → ÷ 0.82   = "commissionable"
   │
   └─▶ × tax gross-up               service charge → NBT → VAT, nested     = SELLING PRICE
```

At booking time the guest is charged the **effective** price:
`selling × (1 − lastMinuteDrop%/100)`, and the tax portion is decomposed back out for
settlement.

## 2. Rounding — two different rules, on purpose

| Function     | Rule                                                                        | Used for                                                                              |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `roundUp(v)` | **Always ceilings** at 2 dp (`ceil`, never `round`) — the legacy `round_up` | Commission and the OTA gross-up (revenue-protective: fractions round in YoHo's favor) |
| `round2(v)`  | Half-away-from-zero (PHP `round`)                                           | Drops, referral commissions, genius/deal amounts                                      |

Getting these two mixed up breaks parity by a cent — which is why they're separate named
functions and both are pinned by tests.

## 3. Yoho commission — two models per property

`properties.commission_type` selects the model (`computeCommission` in `domain/commission.ts`):

- **`percentage`** (default 10%): `commission = roundUp(base ÷ (1 − pct/100) − base)`.
  Note this is _not_ `base × pct` — it's the legacy "gross-up then subtract" form.
  e.g. base 18,000 @ 10% → `18,000 ÷ 0.9 − 18,000` = **2,000.00**.
- **`slab`**: a lookup in `commission_slabs` — the band where
  `slab_start ≤ base ≤ slab_end` supplies a **flat** commission. No matching band is an error
  (never a silent zero). e.g. bands `0–20,000 → 2,500` and `20,000.01–100,000 → 4,000`:
  base 18,000 → **2,500.00**.

## 4. The OTA gross-up

`sellingPrice(base, commission, otaRate = 18)` = `roundUp((base + commission) ÷ (1 − 18/100))`
= `÷ 0.82`. The result is the **commissionable** amount — the tax-exclusive price out of which
YoHo, the OTA, and the property are all paid. The OTA rate is the platform constant
`DEFAULT_CONSTANTS.otaCommissionRate = 18` (config-driven later).

## 5. Taxes — nested, in priority order

Sri Lankan hospitality taxes compound in a fixed nesting order, encoded as
`property_tax_types.priority`: **1 = Service Charge, 2 = NBT, 3 = VAT.**

- **Grossing up** (`sellingFromCommissionable`):
  `selling = commissionable × (1+SC) × (1+NBT) × (1+VAT)` — service charge innermost, VAT
  outermost.
- **Decomposing** (`taxFromSelling`) is the exact inverse — divide out VAT, then NBT, then SC:
  `taxes = selling − ((selling ÷ (1+VAT)) ÷ (1+NBT)) ÷ (1+SC)`.

Tax rates come from the property's config (`resolveTaxRatesForDates`), can vary by date, and
resolve to zero when unconfigured — so untaxed properties multiply by 1 and their numbers are
byte-identical to the pre-tax engine.

## 6. Last-minute drops & promotions

`applyLastMinuteDrop(selling, dropPct)` = `round2(selling × (1 − drop/100))`. The drop lives on
`rate_calendar.last_minute_drop_pct` (0–90). Promotions ("Deals" screen) are applied by writing
their discount into the same column across the property's occupancies for the window — one
mechanism, two authoring surfaces. The stored `selling_price` never changes; the _charged_
(effective) price is computed at display and booking time.

## 7. Coupons & referrals (booking-time, off the charged amount)

- `couponDiscount(amount, type, value)` — percentage or fixed Rs, clamped to `[0, amount]`.
  Validated at booking: active, inside its window, under `max_uses`, property-compatible. The
  guest pays `amount − discount`; the discount and redemption are recorded on the booking.
- `referralCommission(commissionable, pct)` = `round2(commissionable × pct/100)` — earned by the
  partner whose code was attached, recorded per booking (pending → paid).

## 8. Settlement — the money must reconcile to the cent

Every confirmed booking (Approved / CheckedIn / CheckedOut) splits as:

```
grossSelling = propertyBase + yohoCommission + otaCommission + taxes
netPayable   = propertyBase          (what the owner is owed)
```

`decomposeBooking` derives the split from the booking's stored numbers: `commissionable =
gross − taxes`, `otaCommission = commissionable − base − yoho`. Because every part is derived
from the same snapshot (`booking_days`), **the identity holds by construction** — the Finance
screen still displays a live ✓/⚠ reconciliation check as a tripwire.

Related parity functions kept for legacy-compatible surfaces: `systemBaseRate(commissionable,
25)` (the 25% combined take), `geniusAmount` (10% genius discount), `dealAmount`.

## 9. Worked examples (exactly what the dev seed prints)

### A. Percentage commission, untaxed — "Cinnamon Lakeside"

| Step                                                        | Value            |
| ----------------------------------------------------------- | ---------------- |
| Base (owner types)                                          | Rs 18,000.00     |
| Yoho commission (10%): `roundUp(18000/0.9 − 18000)`         | Rs 2,000.00      |
| Commissionable / selling: `roundUp(20000 ÷ 0.82)`           | **Rs 24,390.25** |
| 2-night booking amount                                      | Rs 48,780.50     |
| Settlement: 36,000 base + 4,000 yoho + 8,780.50 OTA + 0 tax | = 48,780.50 ✓    |

### B. Slab commission + taxes — "Ceylon Tax Villa" (10% SC + 15% VAT)

| Step                                                 | Value            |
| ---------------------------------------------------- | ---------------- |
| Base                                                 | Rs 18,000.00     |
| Slab commission (band 0–20,000)                      | Rs 2,500.00      |
| Commissionable: `roundUp(20500 ÷ 0.82)`              | Rs 25,000.00     |
| Selling: `25000 × 1.10 × 1.15`                       | **Rs 31,625.00** |
| Taxes decomposed back out                            | Rs 6,625.00      |
| Reconciliation: 18,000 + 2,500 + 4,500 (OTA) + 6,625 | = 31,625 ✓       |

### C. Last-minute drop on B

15% drop → charged price `round2(31625 × 0.85)` = **Rs 26,881.25**. Tax is decomposed from the
_charged_ price, so settlement still reconciles.

## 10. Display convention

All money is stored `numeric(12,2)` in LKR and displayed as **`Rs 24,390.25`** (`money()` in
`apps/web-extranet/lib/format.ts`); calendar cells use the compact `Rs 24,390` form. Amounts in
templates render via `{{amount}}` with two decimals.
