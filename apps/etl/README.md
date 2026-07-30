# @yohobed/etl — legacy MySQL → Postgres migration

Migrates the legacy YoHoBed database (`armyoftheload`, MySQL) into YoHoBed 2.0 (Postgres), gated
by a numeric parity harness. This is Phase 10 of the rebuild plan and the step that lets the legacy
extranet be switched off.

## The central problem: we do not have the real schema

There is **no mysqldump of production**. The only schema artefact in the repo tree
(`backend-portal/database.sql`) is headed _"Generated from codebase analysis"_ — it is a
reconstruction, and a provably incomplete one:

> `selling_price` — the date-range table TopDown properties price from, read by
> `convertTopDownSellingPricesToSellingPrices` in `extranet/app/Custom/Helper/Util.php` — **does not
> appear in it at all.** It is also singular, where the reconstruction has a plural `sellingprices`
> that is a different, per-date table.

So this ETL never assumes the reconstruction is true. Every table and column it reads is declared in
[`src/contract.ts`](src/contract.ts), and `discover` checks that contract against the real database
before a single row moves.

## Step 1 — `discover` (read-only, safe against production)

The first thing to run once legacy credentials exist. Read-only credentials are sufficient.

```bash
LEGACY_MYSQL_URL='mysql://readonly:pw@host:3306/armyoftheload' \
  pnpm --filter @yohobed/etl discover
```

It reports, per table: whether it exists, its row count, which contracted columns are missing
(required vs optional), which columns exist that the contract does not declare (data we would
silently drop), and the actual column types. Exit code `0` means every required table and column is
present and migration may proceed; `1` means resolve the gaps first.

Undeclared columns do **not** block a cutover — they are a review list, so dropping a column is a
decision someone made rather than something nobody noticed.

## Step 2 — `migrate`

Not implemented yet, deliberately: it is gated on a clean `discover` run, because writing extract
logic against a schema we have not seen produces code that looks finished and is wrong.

Design already fixed by the plan:

- **Tenancy spine** — one legacy `propertyowners` row becomes one tenant (+ user + OWNER
  membership). `properties.propertyowner_id` is what assigns every downstream row to a tenant.
- **The pricing key** — `occupancy_rateplan.id` is what legacy prices and bookings actually key on.
  Preserving that mapping is what keeps legacy BUG #2 (walk-ins priced off `room_id`) fixed.
- **TopDown → per-day** (locked decision): TopDown properties price from `selling_price` date
  ranges; the ETL expands them to one `rate_calendar` row per night so 2.0 has exactly one pricing
  model.
- **Passwords are not migrated.** Every owner gets a reset link at cutover — the only way to
  guarantee no legacy admin backdoor survives.
- **Writes as the owner role, not `yoho_app`.** The ETL writes across every tenant in one pass, so
  it must not be fenced by RLS. This is the one place where bypassing RLS is correct, and the reason
  the ETL is a separate app rather than an endpoint.

## Step 3 — `parity`, the cutover gate

Re-derives every legacy booking's money from the migrated data and diffs it against what legacy
recorded. **The cutover is approved only when the diff set is empty.**

What it checks ([`src/parity/compare.ts`](src/parity/compare.ts), unit-tested in
[`test/parity.test.ts`](test/parity.test.ts)):

| Check                              | Why it matters                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gross_vs_daily_rates`             | `booking_days` is what settlement reconciles against in 2.0. If it cannot reproduce the legacy gross, every future payout for that booking is wrong.                                                                                                 |
| `decomposition_does_not_reconcile` | Tests `gross = base + yoho + ota + taxes` against the recorded OTA commission.                                                                                                                                                                       |
| `base_figures_disagree`            | Legacy carries **two** base figures (`total_base_price`, `total_system_base_price`) and `FinanceController` sums the system one while the extranet shows the other. Where they differ, a human decides which is true before that property cuts over. |
| `missing_daily_rates`              | No per-night snapshot to rebuild from.                                                                                                                                                                                                               |
| `night_count_mismatch`             | `dailyrates` rows disagree with `checkout − checkin`.                                                                                                                                                                                                |
| `negative_component`               | Base + yoho exceeded the commissionable amount — sold below cost, or corrupt.                                                                                                                                                                        |

Tolerance defaults to **0 cents** (exact). `ETL_PARITY_TOLERANCE_CENTS` can absorb legacy float
drift, but raising it is a decision to record, not a way to make a red report go green.

## Configuration

| Variable                     | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `LEGACY_MYSQL_URL`           | Legacy MySQL. Read-only is enough; the ETL never writes to it.      |
| `DATABASE_URL`               | Target Postgres **as the owner role** (see RLS note above).         |
| `ETL_ONLY_PROPERTIES`        | Comma-separated legacy property ids — a pilot cutover of one hotel. |
| `ETL_DRY_RUN=1`              | Validate and report, write nothing.                                 |
| `ETL_BATCH_SIZE`             | Rows per batch for calendars and booking days (default 1000).       |
| `ETL_PARITY_TOLERANCE_CENTS` | Cents of tolerance in the parity gate (default 0 — exact).          |

## Notes on correctness

- **Dates stay strings.** `dateStrings: true` on the MySQL driver, because legacy `DATE` columns are
  calendar dates (a night, a stay), not instants. Letting the driver build JS `Date`s would apply
  the process timezone and could shift a check-in by a day — the classic migration off-by-one.
- **`DECIMAL` stays a string** until the parity harness has compared it, so money never round-trips
  through a float first.
