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

## 10. Multi-currency — base vs display

**FX never touches the pricing path.** Everything in §§1–9 happens in a single currency; a rate is
only ever applied to a figure that is already final. This is deliberate: the engine mirrors legacy
PHP float arithmetic bit-for-bit, and injecting a conversion anywhere upstream would break parity.

### The two tiers

| Tier                                 | Currencies      | Meaning                                                                            |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------- |
| **Base** (`properties.currency`)     | LKR, USD        | What the property prices, stores, invoices and settles in. Exact, never converted. |
| **Display** (`SUPPORTED_CURRENCIES`) | + INR, GBP, EUR | A viewing preference only. Converted at the current rate and prefixed `≈`.         |

A booking records the property's currency **and** `fx_rate_to_lkr`, the rate at the moment of
creation. Rates are stored against an LKR pivot in `exchange_rates` (append-only; `1 base = rate
LKR`), fetched by the worker and overridable by staff.

### Who sets the base currency

Staff, not owners — it decides the denomination of settlement and must match the payee bank
account. `POST /staff/tenants/:id/properties/:pid/currency`, and **refused (409 `currency_locked`)
once the property has any booking**: those bookings are denominated in the old currency, so a change
would reinterpret history rather than convert it. Owners see it read-only on the Setup screen.

### How aggregates are denominated

Any total spanning more than one booking applies one rule (`resolveAggCurrency`,
`apps/api/src/common/currency.ts`):

- **One currency in play** → reported natively and exactly. No FX. A tenant whose properties all
  price in USD sees USD.
- **More than one** → each booking converted via its own snapshotted `fx_rate_to_lkr`, summed in
  LKR, and returned with `approximate: true` so the UI can label it. Historic rates are used on
  purpose: a consolidated total must not drift every time the FX job runs.

Applied to `GET /finance/revenue`, `GET /dashboard` (month gross) and `GET /customers`
(`totalSpend`, folded **per guest** — one guest may have stayed at properties of both kinds).

Since an LKR-only tenant has one currency and `fx_rate_to_lkr = 1`, this is byte-identical to the
pre-multi-currency behaviour.

### Where conversion is forbidden

- **Settlement.** `payout-statement` is scoped to one property and stays exact in its currency; if
  its bookings ever span currencies it raises 409 `mixed_currency_settlement` rather than emit a
  total that adds rupees to dollars. A payout is a payment instruction, never an estimate.
- **Payments vs invoices.** A payment inherits the booking's currency; a caller may assert
  `currency` and a mismatch is rejected 400 `currency_mismatch`. The "is it paid in full?" check
  only totals payments in the invoice's own currency — otherwise 300 USD would settle a 300 LKR
  invoice.

## 11. Display convention

Money is stored `numeric(12,2)` in the property's base currency and displayed with that currency's
symbol — **`Rs 24,390.25`**, `$ 100.00` (`money()` in `apps/web-extranet/lib/format.ts`, symbols
from `CURRENCY_META`); calendar cells use the compact `Rs 24,390` form. LKR remains the default and
the consolidation currency.

A leading **`≈`** means the figure is not exact, from either of two causes: the viewer picked a
display currency other than the amount's own, or the server consolidated a multi-currency aggregate
(`approximate: true`). Amounts in templates render via `{{amount}}` with two decimals.

## 12. Changing the price at the desk (Development Phase 02)

The rate calendar gives every night a **list price** (after any last-minute drop). A reservation
may replace it. Every path runs through one pricer (`apps/api/src/reservations/pricer.ts`), and
the new maths lives in new files (`packages/domain/src/rate-policy.ts`, `money.ts`,
`tax-split.ts`) — nothing in §1–§11 changed. A night priced from the calendar stores exactly what
it always did; a golden test pins `POST /reservations` to `POST /bookings`.

**What each night stores** (`booking_days`): the charged `selling_price`, `tax`, `base_price` and
`commission`, beside the `list_selling_price` and a `rate_source` — `calendar`, `override`,
`contract` or `complimentary` — plus `tax_lines`, the night's tax split per tax.

**A typed rate (override).** The desk enters a tax-inclusive price: `nightly`, a stay `total`
(spread across the nights in proportion to their list prices), `per_night`, or `discount_pct`.
Tax is decomposed from the new price exactly as for any night (`taxFromSelling`). Then:

- **YoHo-distributed:** base and commission scale with the price by
  `r = new tax-exclusive ÷ list tax-exclusive`, each rounded **half-up** (never round-up). What is
  left is the OTA's margin, and it is clamped so it can never go negative.
  _Example:_ list Rs 24,390.25 (base 18,000 + commission 2,000) typed down to Rs 12,195.13 →
  r ≈ 0.5 → base 9,000.00, commission 1,000.00, OTA margin 2,195.13.
- **Standalone:** no commission; the property keeps the whole tax-exclusive price.

A night whose typed price equals its list price stays a calendar night.

**Contract rates** (Pro): a travel agent's or company's rate for the room type — a fixed
tax-inclusive nightly rate, or a percentage off the list — priced like an override but recorded
as `contract`, and needing no approval. Nights no contract row covers fall back to the account's
standing `discount_pct`, else to the list.

**Complimentary:** every night is zero — selling, tax, base and commission — and the room is
still taken out of inventory.

**Tax exemption:** the night's tax is split per tax (`splitInclusiveTax`: the same compounding as
the engine — service charge on the net, the second slot on net + service charge, VAT on all of
it — with the cents apportioned so the lines add up to the stored tax exactly). The taxes marked
`exemptible` are removed from both the price and the tax; base and commission are untouched,
because the tax was never theirs. A service charge is never exemptible.

_Worked split (Sri Lanka, 10% SC → 2.5% SSCL → 18% VAT on a Rs 10,000 night):_ tax 2,483.75 =
SC 751.63 + SSCL 206.70 + VAT 1,525.42.

**Amending** re-prices under the same terms (`bookings.pricing`): a nightly rate or percentage
carries over; a stay total or per-night prices become a nightly rate at the average the guest was
paying; a contract, a complimentary room and an exemption stay as they were.

**Coupons across several rooms:** the discount is computed on the reservation total, exactly as
the walk-in did for one room, and shared across the rooms in proportion to their price.
