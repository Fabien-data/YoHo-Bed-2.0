# YohoBed 2.0 — Yanolja-Parity PMS Roadmap

> The approved multi-sprint program to rebuild YohoBed 2.0 as a full hotel PMS at feature parity
> with — and beyond — Yanolja Cloud Solution, sold as subscription SaaS. Approved 2026-08-18.
>
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA-MODEL.md](DATA-MODEL.md) ·
> [API.md](API.md) · [GAP-ANALYSIS.md](GAP-ANALYSIS.md) (superseded for sequencing by this file)

## Sprint status

| Sprint | Phase           | Deliverable                            | Status         |
| ------ | --------------- | -------------------------------------- | -------------- |
| 0      | 0 Foundations   | SaaS entitlements + property depth     | ✅ **Done**    |
| 1      | 0 Foundations   | Design system + Yanolja app shell      | ✅ **Done**    |
| 2      | 1 Front desk    | Room units + live migration            | ⏳ Next        |
| 3      | 1 Front desk    | Stay View tape chart                   | ⬜ Not started |
| 4      | 1 Front desk    | Room View, Reservations, Housekeeping  | ⬜ Not started |
| 5      | 2 Money core    | Folio + charge posting                 | ⬜ Not started |
| 6      | 2 Money core    | Cashiering, ledgers, POS               | ⬜ Not started |
| 7      | 2 Money core    | Night audit                            | ⬜ Not started |
| 8      | 3 Rates & dist. | The 7-tab ARI grid                     | ⬜ Not started |
| 9      | 3 Rates & dist. | Distribution + per-channel commission  | ⬜ Not started |
| 10–11  | 4 Reports       | Analytics + async export queue         | ⬜ Blocked¹    |
| 12–13  | 5 Growth        | Guest portal, booking engine, payments | ⬜ Not started |
| 14+    | 6 AI            | MCP, Copilot, Revenue Manager, Healer  | ⬜ Not started |

¹ Blocked on receiving Yanolja Snapshots Part 02 — see "Open items" below.

## Context

YohoBed 2.0 today is an **OTA-distribution extranet**, not a hotel PMS. It is unusually well
engineered for what it is — Postgres RLS multi-tenancy, a parity-tested money engine, a
transactional-outbox channel pipeline, 167 Vitest tests, CI and PM2 deploys — but a hotelier
evaluating it against Yanolja Cloud Solution finds no tape chart, no individually numbered rooms,
no housekeeping, no folio, no POS, no night audit, no group/agent/company side and almost no
reporting.

The goal is to replace Yanolja Cloud Solution (eZee Absolute "Unity") as a **subscription SaaS**
product, sold worldwide. Staff switching from Yanolja must find the screens familiar, so the
information architecture deliberately mirrors Yanolja's — then exceeds it on the four things
YohoBed already does better (provable distribution, correct money, real multi-tenancy) plus AI.

### Decisions locked with the owner (2026-08-18)

| Decision                    | Choice                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commercial model            | **Subscription SaaS.** Needs a plan/entitlement layer from Sprint 0 (Yanolja's "Know Your Plan").                                                                                              |
| Commission layer            | **Feature-flagged per tenant.** `distribution_mode = yoho \| standalone`. YoHo-distributed hotels keep commission/payout/settlement; standalone PMS subscribers see plain rates. One codebase. |
| First shippable milestone   | **Front-desk core** — room units, Stay View tape chart, Room View, Reservations tabs, check-in/out, housekeeping.                                                                              |
| Live data at yova.markui.lk | **Auto-migrate, keep data.** Expand each `rooms.quantity = N` into N numbered units and back-fill bookings. No tester disruption; rehearses real hotel onboarding.                             |
| Multi-property              | **Single-property UI first, chain-ready schema.** Property switcher in the header exactly like Yanolja; group dashboards deferred, no later migration needed.                                  |

## The two structural blockers (must be solved before anything else)

**1. `rooms` is a bucket, not a room.** `packages/db/src/schema/inventory.ts:36` — a `rooms` row is
`{name, quantity: N}`, one row per room-type-per-property, and `availability_calendar` is keyed on
`(room_id, date)` with `rooms_to_sell`. `bookings.room_id` points at the bucket and `bookings.rooms`
is a count. Nothing in the system can name room "05". That single fact blocks Stay View, Room View,
room assignment, housekeeping, maintenance blocks, work orders and the House Status grid — i.e. most
of the front-desk core.

**2. The UI kit cannot carry these screens.** `apps/web-extranet/components/ui.tsx` is 139 lines —
`Logo, Button, Card, Field, Modal, Pill`. Yanolja's surface needs a virtualized tape chart, a
7-tab inline-editable ARI grid with dirty-state save, right slide-overs, command palette,
counted chips, data tables with column menus, and an audit-trail drawer on every module. Every
page is also a `'use client'` component hand-calling a 934-line `lib/api.ts` with no cache layer.

## Resolution 1 — the room-unit model (additive, not a rewrite)

Do **not** repurpose `rooms`. Keep it as the _sellable bucket_ that `availability_calendar`,
`rate_plans`, `cm_room_mappings` and the outbox already speak, and add physical units beside it.
Nothing existing changes shape, so the 167 tests and the AxisRooms wire format stay green.

```ts
// packages/db/src/schema/inventory.ts — added
export const roomUnits = pgTable(
  'room_units',
  {
    id,
    tenantId,
    propertyId,
    roomId, // -> rooms.id, the bucket/room-type this unit belongs to
    code, // "01", "05" — what the tape chart shows
    displayOrder,
    floor,
    notes,
    status, // pgEnum room_unit_status: active | inactive
  },
  (t) => ({ codeUq: unique().on(t.propertyId, t.code) }),
);

// packages/db/src/schema/bookings.ts — added
export const bookingRooms = pgTable('booking_rooms', {
  id,
  tenantId,
  bookingId,
  roomUnitId, // nullable = not yet assigned
  legIndex,
  checkin,
  checkout,
  adults,
  children,
});
export const bookingGroups = pgTable('booking_groups', { id, tenantId, propertyId, code, name });
// + bookings.groupId (nullable)
```

- **One bar per physical room** comes from `booking_rooms`, `n` legs where `n = bookings.rooms`.
  Money stays on `bookings` / `booking_days`, so `packages/domain` is untouched.
- Yanolja splits a multi-room booking into sibling reservations under a Group ID (`3359-1`,
  `3359-2`). We reproduce that _presentation_ via `booking_groups` without splitting the money.
- `SUM(active room_units) = rooms.quantity` is surfaced as a setup warning, not a DB constraint —
  out-of-order units must be allowed to diverge.

**Migration `0020` sequence** (`packages/db/drizzle/`; Sprint 0 consumed `0019_saas_entitlements`):

1. DDL for `room_units`, `booking_rooms`, `booking_groups`, `maintenance_blocks` + `bookings.group_id`.
2. Data: for each `rooms` row emit `quantity` units coded `01..NN`.
3. Data: for each non-terminal booking emit `rooms` legs and greedily assign a free unit per date range.
4. RLS policies for the four new tables appended to `packages/db/src/rls.sql`.

## Resolution 2 — the UI foundation

Adopt **shadcn/ui (Radix primitives) + TanStack Table + TanStack Virtual + TanStack Query**, vendored
into a new `packages/ui` workspace package.

- shadcn is copy-in source, not a dependency — it keeps the hand-rolled aesthetic and the existing
  `globals.css` custom-property tokens (which already map 1:1 onto shadcn's token contract), so the
  dark-default theme survives untouched.
- Radix supplies the primitives the Yanolja clone needs and that are genuinely hard to hand-roll
  correctly: `Sheet` (the right slide-over used on every screen), `Command` (omni-search),
  `DropdownMenu`, `Popover`, `Tooltip`, `Select`, `Switch`, `Tabs`, `Toast` — all accessible and
  focus-managed.
- TanStack Table + Virtual are non-negotiable for the tape chart and the 7-tab ARI grid; a 90-day ×
  40-unit chart is 3,600 cells and cannot be naive DOM.
- **Yes to TanStack Query.** Keep `lib/api.ts` (934 lines) as the transport and wrap it in typed
  hooks under `lib/queries/`. This is what makes the counted chips, the 20s notification poll and
  the optimistic inline-grid edits tractable. It is a wrapper, not a rewrite.

New shared components to build once and reuse everywhere, mirroring Yanolja's patterns:
`SlideOver`, `CountedChips`, `CountedTabs`, `DataGrid`, `EditableGrid` (dirty-state + Save),
`AuditTrailDrawer`, `ExportButton`, `EmptyState`, `MoneyFooter`, `MetricFooter`, `ChannelChip`.

## Phased delivery

Two-week sprints. Every sprint ends demoable to a hotelier.

### Phase 0 — Foundations (Sprints 0–1)

**Sprint 0 — SaaS entitlements + property depth.** _No Yanolja module; unblocks the business model._

- DB: new `packages/db/src/schema/billing.ts` — `plans(code, name, price_monthly, currency, features jsonb)`,
  `subscriptions(tenant_id, plan_id, status trialing|active|past_due|cancelled, period_start/end, seats)`,
  `tenant_features(tenant_id, key, enabled, limit)`. Add `tenants.distribution_mode` enum `yoho|standalone`.
- DB: `properties` gains `address, city, country, timezone, checkin_time, checkout_time, star_rating,
phone, email, logo_media_id` — required later by registration cards, guest messages and night audit.
- API: new `apps/api/src/billing/` module (register in `app.module.ts` alongside the existing 21);
  `GET /billing/plan`, `GET /billing/entitlements`, staff-only `POST /staff/tenants/:id/plan`.
  New `EntitlementGuard` + `@Feature('housekeeping')` decorator beside the existing `RolesGuard`.
- Money: in `standalone` mode `yohoCommission = 0` and payout/settlement screens are hidden by
  entitlement. `packages/domain` is _not_ modified — the flag selects the commission input.
- Tests: entitlement-guard e2e; a `standalone` tenant's quote carries no YoHo commission.
- **Acceptance:** a `starter`-plan tenant gets 403 on gated endpoints; "Know Your Plan" page renders.

> **✅ Shipped 2026-08-18.** Migration `0019_saas_entitlements`. New:
> `packages/domain/src/entitlements.ts` (`FEATURE_KEYS`, `LIMIT_KEYS`, `resolveEntitlements`,
> `withinLimit`, `commissionStructureFor`), `packages/db/src/schema/billing.ts`,
> `packages/db/src/default-plans.ts` (starter/pro/enterprise catalogue, seeded not hardcoded),
> `apps/api/src/billing/`, `apps/api/src/common/{feature.decorator,entitlement.guard}.ts`,
> `apps/web-extranet/app/app/plan/page.tsx`.
>
> Two findings worth carrying forward. First, **the parity core needed no change at all**:
> `computeCommission` with `percentage: 0` already returns 0, so `commissionStructureFor()` just
> hands standalone tenants a zero-percentage structure — verified for both percentage and slab
> properties. Second, `plans` is deliberately **not** RLS-fenced (global catalogue) while
> `subscriptions`/`tenant_features` are, so `BillingService` reads the latter through
> `withTenant()`; reading them on the unscoped handle silently returns nothing.
>
> Test count 167 → **197** (domain 42→56, API e2e 63→78). `makeTenant()` in the e2e harness now
> takes `plan` and `distributionMode`, and `request()` takes `tenantId`, ready for gating routes
> in later sprints.

**Sprint 1 — Design system + Yanolja app shell.** _Yanolja module A0._

- New `packages/ui` (shadcn + Radix + TanStack), Tailwind preset exporting the existing tokens.
- `lib/queries/` TanStack Query hooks wrapping `lib/api.ts`.
- Rebuild `apps/web-extranet/app/app/layout.tsx` (today: fixed 256px sidebar) into the Yanolja
  topology — left drawer with the full module tree, property name + code header with switcher,
  omni-search command palette, header quick actions, Quick Menu grid, 3-tab notification bell,
  release-notes feed. Keep `ThemeToggle`, `CurrencyPicker`, `NotificationsBell`.
- Playwright introduced; smoke test over the existing 11 routes.
- **Acceptance:** all 11 current pages render unchanged inside the new shell; `pnpm test` green.

> **✅ Shipped 2026-08-19.** New `packages/ui` — **source-only, no build step**: it exports raw
> `.tsx` and the app lists it in `transpilePackages`, so `'use client'` boundaries survive intact,
> edits are live in dev, and there is no tsup/DTS pipeline to maintain. Tailwind's `content` glob
> must include `../../packages/ui/src/**` or every component renders unstyled.
>
> Primitives: `Button` (Radix Slot `asChild`), `Sheet` (the right slide-over), `Menu`, `Popover`,
> `Tooltip`, `Input`/`Field`, `Select`, `Switch`, `Checkbox`, `Tabs` (with counts), `Card`,
> `Badge`, `Skeleton`, `EmptyState`, `PageHeader`. Patterns: `CountedChips`, `MoneyFooter`,
> `MetricFooter`, `DataGrid` (TanStack Table), `AuditTrailDrawer`. All styled purely through the
> existing CSS custom-property tokens, so the dark-by-default theme was untouched.
>
> Shell: `components/app-shell.tsx` replaces the fixed 256px sidebar with Yanolja's topology —
> drawer nav grouped Front desk / Rates & availability / Distribution / Guest / Cashiering /
> Configuration, property identity header, Ctrl-K omni-search (`components/command-palette.tsx`),
> Quick Menu grid, notification bell, profile menu. `lib/sections.ts` was replaced by
> `lib/nav.ts` (grouped, icon-bearing, entitlement-gated). TanStack Query added via
> `components/providers.tsx` + `lib/queries.ts`, wrapping `lib/api.ts` rather than replacing it.
>
> **Playwright** in `apps/web-extranet/e2e/` — 16 tests, `pnpm --filter @yohobed/web-extranet e2e`.
> Two traps cost real time and are configured around: `NEXT_PUBLIC_API_URL` is **inlined at build
> time**, so the API must run on the port baked into the bundle (3001) rather than one chosen by
> the test config; and the API's `CORS_ORIGINS` defaults to `localhost:3000`, so the Playwright
> origin has to be passed in explicitly or every authenticated request fails silently.
>
> Test count **197 → 213** (197 Vitest + 16 Playwright).

### Phase 1 — Front-desk core (Sprints 2–4) ← first hotel demo

**Sprint 2 — Room units + live migration.** _Foundational._

- Migration `0020` per Resolution 1, plus `maintenance_blocks(room_unit_id, block_from, block_to,
reason, blocked_by_user_id)`.- API in `apps/api/src/inventory/`: `GET|POST /properties/:id/room-units`, `PATCH /room-units/:id`,
  `POST /bookings/:id/assign`, `POST /bookings/:id/auto-assign`.
- Tests: db-integration proving the migration preserves every booking and never double-books a unit;
  e2e for assignment conflicts.
- **Acceptance:** yova.markui.lk migrates in place, zero data loss, every booking has legs.

**Sprint 3 — Stay View.** _Yanolja module A1 — the screen the product is judged on._

- API: one `GET /stayview?propertyId&from&to` returning room-type groups → units → bars, plus the
  per-date availability / rate / occupancy footer rows.
- New route `app/app/stayview/page.tsx`: virtualized tape chart; counted chips
  (All/Vacant/Occupied/Reserved/Blocked/Due Out/Dirty); date picker; group-by; rate-plan selector;
  15-day window with paging; hatched maintenance bars with Unblock/Edit context menu; hover card;
  right slide-over detail with sticky Total/Paid/Balance; Group Reservation List panel; footer
  Available Inventory + Occupancy %. Drag to move a booking between units; drag to extend a stay.
- **Acceptance:** 40 units × 90 days scrolls smoothly; moves write through and emit outbox events.

**Sprint 4 — Room View, Reservations, Housekeeping.** _Yanolja modules A2, A3, A8._

- Room View card grid with the full badge set (payment due, arrival, DND, housekeeping, VIP,
  multi-guest, OTA logo, out-of-order wrench).
- Reservations rebuild: Individual/Group toggle, counted tabs, card+list views, Export, advanced
  search, Make Group / Merge Group, Print GR registration card.
- Housekeeping: `housekeeping_status(room_unit_id, date, status dirty|clean|inspected|out_of_order,
assigned_to_user_id, remarks)` and `work_orders(...priority, assign_to, deadline, status)`.
  Screens: House Status grid with inline dropdowns, Maintenance Block, Work Order/Task.
  Room Status derived — Vacant / Arriving Today / Pending Checkout / Checked Out / Out Of Order.
- Guest depth: `customers` gains nationality, ID/passport, address, DOB, VIP; Guest Database screen.
- **Acceptance: a hotel can run a full day** — view the chart, assign a walk-in, check in, mark rooms
  dirty/clean, block a room for maintenance, check out.

### Phase 2 — Money core (Sprints 5–7)

**Sprint 5 — Folio + charge posting.** _Yanolja "Front Desk Operations"._
`folios`, `folio_charges`, `folio_payments`, `charge_particulars`, `folio_transfers`. Room charges
post from the existing `booking_days` snapshot — no new money math. Unsettled-folios screen, folio
window on the reservation slide-over, split/transfer bill.

**Sprint 6 — Cashiering, ledgers, POS.** _Yanolja module A7 (all 8 sub-modules)._
`ledger_accounts` unifying Travel Agent / Company / Sales Person, `business_sources(short_code, name,
color, status)` driving Stay View colours. Cashiering Center; `cash_drawers` + `drawer_sessions`
(open/close, declared vs expected, Cashier Report); Expense Voucher; POS / Incidental Invoice with
Tax Operation; Exchange Rate editor reusing the existing `exchange_rates` table and `fx` module.

**Sprint 7 — Night audit.** _Yanolja module A9._
`business_dates(property_id, current_date)`, `night_audit_runs(property_id, from/to, run_by, ip,
summary jsonb)`. Run Night Audit posts room charges + taxes, auto-no-shows unarrived reservations,
force-closes drawers, rolls the business date and logs user + IP. Night Audit Log; Insert Transaction
back-dated-stay form with the full Yanolja field set and Billing Summary rail.
**Acceptance:** seven consecutive audits on demo data; posted revenue reconciles to the payout
statement to the cent.

### Phase 3 — Rates & Distribution parity (Sprints 8–9)

**Sprint 8 — the 7-tab ARI grid.** _Yanolja module A4._
Add `cta`/`ctd` to `availability_calendar`; `rate_plans.derived_from_id` + `derive_type/value`;
extra adult/child rates; `rate_thresholds(rate_plan_id, min_rate, max_rate)`. Rebuild
`app/app/calendar/page.tsx` (784 lines today) as Inventory / Rates / Minimum Nights / Maximum Nights
/ Stopsells / COA / COD with inline-editable virtualized cells, dirty-state Save, Import/Export,
bulk update, Hide Derived Rate Plans, Rates Inclusive Tax, sticky Sold/Available/Total footer.
Promotions with Sync; Rate Threshold slide-over.

**Sprint 9 — Distribution.** _Yanolja module A5._
`channels(code, name, logo, commission_pct, currency, status)` + `channel_credentials(property_id,
channel_id, hotel_code, username, password_encrypted)`. Per-channel commission is passed into the
existing `otaRate` parameter — **`DEFAULT_CONSTANTS.otaCommissionRate` stays 18** so parity tests
never move. Channel Logs from `outbox` + `ota_reservations` **with one-click replay** (beats
Yanolja's read-only log); Auto Stopsell; Channel Passwords; two-way Guest Messaging threaded per
reservation. AxisRooms go-live when credentials land.

### Phase 4 — Reports & analytics (Sprints 10–11)

ADR, RevPAR, occupancy, pace/pickup, channel mix, cancellation rate, lead time, LOS, source/segment,
manager flash. Reports library plus the async **Exported Reports** queue (worker job → `media`
storage → download). Dashboard and Guest Statistics rebuild.
_Blocked on receiving Snapshots Part 02 (Reports, Configuration, Dashboard, Innalytics)._

### Phase 5 — Growth surface (Sprints 12–13)

Guest Portal self check-in via reservation number + PIN (exactly the flow in Yanolja's pre-arrival
email), direct booking engine, payment gateway, reputation management, housekeeping PWA, and the
B2B Marketplace powered by **YoHo's own demand** instead of third-party resellers.

### Phase 6 — AI layer (Sprint 14+)

`packages/mcp` exposing the RLS-fenced domain as MCP tools; Supplier Copilot; AI Revenue Manager;
Distribution Healer over the outbox.

### Cross-cutting, every sprint

Audit trail on each new module (user + IP, per Yanolja); Export on every list; counted chips; empty
states; Playwright coverage for the screen just shipped; docs updated in `docs/` (note
`ARCHITECTURE.md` §7 and the "105 tests" figure are already stale).

## Verification

- `pnpm -w test` — the 167 existing Vitest tests must stay green through every sprint; new suites
  land beside them (`packages/db/test/` for migration integrity, `apps/api/test/*.e2e.test.ts` for
  each new module).
- `pnpm -w typecheck && pnpm -w build` and the GitHub Actions pipeline (migrate → seed → typecheck →
  build → test → format).
- **Migration rehearsal:** restore a yova.markui.lk backup (`infra/backup.sh`) into a scratch
  database, run `db:migrate`, assert booking counts and folio totals are unchanged, and assert no
  room unit is double-booked on any date.
- **Local run:** `docker compose up` (Postgres :5433, Redis :6380), `pnpm db:migrate && pnpm db:seed`,
  `pnpm dev`. Use `127.0.0.1` not `localhost` in `APP_DATABASE_URL` or the API 500s.
- **Manual demo script per sprint**, extending `scripts/demo-data.mjs` and
  `docs/DEMO-WALKTHROUGH.pdf`: the Phase 1 exit test is a full simulated hotel day.
- Playwright E2E on Stay View, the ARI grid and the night-audit run — the three highest-risk screens.

## Open items to resolve before Phase 4

1. **Snapshots Part 02** — Reports, Configuration, Dashboard, Innalytics, Guest Portal and Net Locks
   are referenced in Yanolja's nav but not in Part 01. Needed before those phases can be designed.
2. **Legacy MySQL credentials** — still blocking `apps/etl migrate`. Off the critical path but
   blocking any real-hotel cutover.
3. **AxisRooms credentials** — blocking channel-manager go-live.
4. **Pricing tiers** — what the `starter` / `pro` / `enterprise` plans actually gate, to make the
   Sprint 0 entitlement keys real rather than placeholder.

## Where YohoBed must EXCEED Yanolja, not just match it

Copying Yanolja gets us to parity, which only wins on price. These seven are the reasons a hotel
switches. Each is already latent in the codebase — none is a from-scratch bet.

1. **AI-native operations (the headline wedge).** Yanolja has zero AI. YohoBed already plans
   `packages/mcp`. Ship a Copilot that reads the same RLS-fenced data the UI does: natural-language
   ARI edits ("close Deluxe next weekend, +15% on Saturday"), a Revenue Manager that proposes rates
   from pace/pickup, and a Distribution Healer that watches the outbox and repairs failed pushes.
   AI belongs _after_ the front-desk and money cores exist — an agent with nothing to act on is a demo,
   not a product.
2. **Provable distribution.** The transactional outbox (`packages/db/src/outbox.ts` + the BullMQ
   relay) already gives at-least-once delivery, retry, dead-letter and replay. Yanolja's Channel Logs
   is a read-only audit list. Ship "every ARI change, its delivery state, and a one-click replay".
3. **Correct money, proven.** `packages/domain` is float-parity-tested against the legacy PHP.
   Yanolja has no equivalent guarantee. Sell reconciliation-to-the-cent as a feature (the payout
   statement already does this).
4. **Real multi-tenancy.** Postgres RLS + a restricted `yoho_app` role is defence-in-depth Yanolja
   does not advertise. This is what makes the chain/group story credible later.
5. **Built-in B2B demand.** Yanolja's B2B Marketplace resells _other people's_ demand partners at
   18–50% commission. YohoBed **is** a bedbank — plug the hotel straight into YoHo's own demand.
6. **Modern UX.** Dark mode (Yanolja has none), keyboard-first navigation with a command palette,
   virtualized grids, and an offline-tolerant PWA for housekeeping trolleys.
7. **Open platform.** Public API + webhooks + an MCP server. Yanolja is closed.

## Risks and dependencies

| Risk                                                | Impact                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Room-unit migration touches the live deployment** | `bookings`, `availability_calendar`, `cm_room_mappings`, RLS policies and 167 tests all reference `rooms` | Additive-only: keep `rooms` as the sellable bucket, add `room_units` beside it. Nothing existing changes shape, so the test suite and the CM wire format stay green.                                                                                                                                           |
| **Multi-room bookings (`bookings.rooms > 1`)**      | A tape chart needs one bar per physical room; the money engine is per-booking                             | Add a `booking_rooms` leg table (n rows where n = `bookings.rooms`) carrying the unit assignment. Money stays on `bookings` — the domain package is untouched. Yanolja instead splits into sibling reservations under a Group ID; we layer `booking_groups` for that presentation without splitting the money. |
| **Hardcoded 18% OTA commission**                    | `packages/domain/src/pricing.ts:7` `DEFAULT_CONSTANTS.otaCommissionRate = 18`                             | It is already a _parameter_ (`otaRate` on the pricing fns) — only the default is 18. Introduce a `channels` master with per-channel commission and pass it in. **Keep the default at 18** so the parity tests never move.                                                                                      |
| **ETL / cutover blocked**                           | `apps/etl migrate` is unimplemented, pending real legacy MySQL credentials                                | Off the critical path. Front-desk core does not need legacy data. Keep chasing credentials in parallel.                                                                                                                                                                                                        |
| **AxisRooms credentials**                           | Real CM go-live blocked; `resolveAdapter()` throws rather than silently faking                            | Continue on `fake` provider; the 19 contract tests already pin the wire format, so go-live is a config change.                                                                                                                                                                                                 |
| **Yanolja's model vs YohoBed's money engine**       | Yanolja has no platform-commission layer; its rates are the hotel's rates                                 | This is exactly what `distribution_mode` resolves. In `standalone` mode `yohoCommission = 0` and the payout/settlement screens are hidden by entitlement.                                                                                                                                                      |
| **Scope**                                           | Yanolja Part 01 alone is ~40 screens; Reports/Configuration/Innalytics are not even in this PDF           | Phase strictly by demoability. Ask for Snapshots Part 02+ (Reports, Configuration, Dashboard, Innalytics, Guest Portal) before planning those phases in detail.                                                                                                                                                |
| **Zero frontend tests**                             | The riskiest new code (tape chart, ARI grid) has no safety net                                            | Add Playwright in Sprint 0 alongside the design system; make the tape chart the first E2E-covered screen.                                                                                                                                                                                                      |

## Appendix A — Yanolja Cloud Solution (eZee Absolute "Unity") feature inventory

Source: `Competitor Software/Yanolja_Cloud_Solution_PMS_-_Snapshots_Part_01.pdf`, 30 pages / 55 screenshots,
tenant `The Panorama Residence` (property code 45523), host `live.ipms247.com/unity/*`.

### A0. Global application shell

- Left slide-out drawer nav (hamburger), property name + property code at top, `yanolja Cloud Solution` footer with Terms/Privacy.
- Nav tree: **Stay View · Room View · Reservations · Rates & Availability**(Rates, Promotions, Rate Threshold) **· Distribution · Guest · Cashiering**(8 children) **· Housekeeping**(3) **· Night Audit**(3) **· B2B Marketplace**(NEW badge) **· Net Locks · Reports · Exported Reports**.
- Global omni-search: "Search reservations, guests and more" + info tooltip.
- Header quick-action icons: Add Reservation, Stay View, Reservations, Rates ($), **Quick Menu** grid.
- Quick Menu: Dashboard · Innalytics · Guest Statistics · Guest Portal (badge) · User Activity · Night Audit · Reputation Management · Revenue Management Preview (NEW) · B2B Marketplace.
- Notification bell (3 tabs, 9+ badge) — e.g. "Reservation … from Booking.com … contains unmapped rateplan", with See all.
- Announcements megaphone — in-product "What's new" release-note feed with 😞/😐/😃 reactions and Read More links.
- Profile menu: account settings, Go to Configuration, Marketplace, Know Your Plan, Security Advisory, University, Help, Logout.

### A1. Stay View (tape chart) — `/unity/stayview`

- Business-date picker; status filter chips **with live counts**: All · Vacant · Occupied · Reserved · Blocked · Due Out · Dirty.
- Group-by dropdown (Room Type), rate-plan selector (BB), **Assign Room** action.
- Horizontally scrolling ~15-day grid, prev/next chevrons, weekday + date column headers.
- Room-type parent row per date: **availability count badge + rate** (e.g. `2 / 73.00`).
- Room rows with per-room icons (DND, housekeeping).
- Booking bars spanning dates: colour = status (green confirmed/in-house, red due-out/checked-out, blue/dark = other), leading **source icon** (Booking.com, Expedia, Agoda, direct/walk-in, OTA-generic), guest name, truncation.
- **Blocked room** = full-width hatched navy bar with reason text ("WATER LEAK"); context menu → Unblock Room / Edit Block Room.
- Hover card: guest name, status chip, "Payment Pending".
- Click → right slide-over: Edit Reservation · More Options ▾ · Print/Send ▾; Reservation Number, Status, Arrival & Departure (date + time), Booking Date, Room Type, Room Number, Rate Plan, Pax (adult/child icons), Avg. Daily Rate, free-text Remarks (booked rate, meal-plan pricing, cancellation policy, OTA room/rate IDs, booker name), sticky footer **Total / Paid / Balance**.
- Group booking → second panel **Group Reservation List**, grouped by room type, one card per room-night leg (status chip, res no, voucher no, room, pax).
- Footer summary rows: **Available Inventory** per date, **Occupancy %** per date with colour-graded mini bar.
- `Default Unmapped Room` / `Default Unmapped Rate` pseudo-rows for unmapped OTA inventory.

### A2. Room View — `/unity/roomview`

- Same date + status chips; responsive grid of room cards.
- Card: room number (colour-coded by status), guest name, corner badges — payment due `$`, arrival/departure calendar, DND, housekeeping, VIP crown, shared/multi-guest, OTA source logo, wrench glyph for out-of-order.

### A3. Reservations — `/unity/reservations`

- Individual/Group toggle (two icon buttons) + card/list view toggle.
- Individual tabs with counts: **Reservations · Arrivals · Departures · In-house**.
- Group tabs with counts: **Reservations · Departed · In-house**.
- Toolbar: Print GR (registration card), **Make Group**, **Merge Group**, Export, advanced Search.
- Card: status colour bar, source logo, guest name, VIP crown, multi-guest glyph, `resNo | OTA/voucher no`, arrival date+time — **N Nights** — departure date+time, Booking Date, pax adults/children, `Room / Rate plan`, inline **Confirm Booking** action, Total / Paid / Balance, kebab menu.
- Group card adds: **Group ID**, **Rooms n (n)**, group **Rate**.

### A4. Rates & Availability — `/unity/ratewizard/ratesinventory`

- Seven tabs: **Inventory · Rates · Minimum Nights · Maximum Nights · Stopsells · COA · COD**.
- Toolbar: Import, Export, bulk-update menu, Save (dirty-state enabled).
- Filters: **OTA Common Pool** selector, group-by Room Type/Rate Plan, date stepper + picker.
- Rates tab: radio **Base Rates / Extra Adult Rates / Extra Child Rates**; checkboxes **Hide Derived Rate Plans**, **Rates Inclusive Tax**; banner "Rates are in $ and are Tax Exclusive".
- Grid: room-type parent row (with room count + per-date availability), rate-plan child rows with **derived-plan indicator** (↻ n) and copy-to-all glyph; every cell inline-editable.
- Sticky footer: **Sold Rooms · Available Inventory · Total Rooms** per date.
- **Promotions** `/unity/packages`: Active/Inactive tabs with counts, search, channel filter, **Sync**, Create.
- **Rate Threshold**: slide-over, min/max rate guardrail per rate plan, grouped by room type, Reset/Save.

### A5. Distribution

- **Auto Stopsell**: slide-over — Source select, per weekday toggle + time-of-day, Audit Trail, Save.
- **Channel Logs** `/unity/channellogs`: Source, For Date, Request Date & Time (IST), Process Date & Time (IST), Updated Value, User, Status; Search, Export.
- **Channel Passwords**: slide-over — Channel (Hotel Code) with logo, User Name, Password (masked/reveal); "master credentials are used" state. Channels seen: Agoda, Booking.com, Emerging Travel Group (Ostrovok), Expedia.
- **Guest Message** `/unity/guestmessage`: channel selector, left inbox (guest name, OTA thread id, snippet), right thread with Check-in / Nights / Check-out header, rendered message body, composer with attachment + send. Templated pre-arrival mail includes **Guest Portal reservation no + PIN** for self check-in.

### A6. Guest

- **Guest Database** `/unity/guestdatabase`: quick search, Add Guest, Export, Audit Trail, advanced Search; columns Guest Name, Country, Email, Phone, Mobile, VIP Status, row kebab, multi-select checkboxes.
- **Front Desk Operations** `/unity/unsettledfolios`: Folio#, Reservation#, Guest Name, Arrival, Departure, Status, Balance (negative allowed), row kebab.

### A7. Cashiering (8 sub-modules)

1. **Cashiering Center** `/unity/cashieringcenter` — City Ledger selector; Posting Date vs Departure Date radio; date range; checkboxes Pending Ledger Commission, Display Void; KPI tabs **City Ledger Total · Unpaid Invoice · Unassigned Payments · Assigned Payments**; **Opening Balance** and **Closing Balance**; ledger table Date, Description, Payment Type, User, Credit, Debit, Assigned, Unassigned, Balance; Add New Payment, Export, Send Email, Print.
2. **Cash Drawer** `/unity/cashdrawer` — "manage drawers, start/end session, monitor live balances, cashier reports"; tabs Drawers / Cashier Report; filters status + user; table Drawer Name, Assigned User, Balance, Last Opened, Last Closed, Status, Actions; Create Drawer, Audit Trail.
3. **Travel Agent Database** `/unity/travelagent` — Agent Name, Contact Name, Country, Phone, Email, Status, **Balance($)**; agents auto-created per OTA (Agoda-1255133, Booking.com-1314711, Expedia-100378850, Walk-in).
4. **Business Source** `/unity/businesssource` — Short Code, Business Source, **Colour**, Status (drives stay-view colouring).
5. **Sales Person Database** `/unity/salesperson` — Sales Person, Country, Email, Phone, Mobile, Status.
6. **Company Database** `/unity/company` — Company, Contact Person, Country, Email, Phone, Status, Balance($).
7. **Expense Voucher** `/unity/expensevoucher` — list + Hide Void + date range; Add slide-over: Contact Type (Guest/Agent/Company), Name with picker/search, Voucher Number, Voucher Date, Prepared By, Payment Method; repeating **CHARGES** lines (Particular, Comments, Amount) and **PAYMENTS** lines (Type, Comments, currency, Amount); running **Balance**.
8. **POS / Incidental Invoice** `/unity/POS` — same voucher shell plus **Payment Type: Cash/Bank vs City Ledger** and a **Tax Operation** action on charges.

- **Exchange Rate**: slide-over — per-currency rate table, `SLRs 300.0000 = $ 1.0000`, `€ 320.0000 = $ 1.0000`, base row locked at 1.0000.

### A8. Housekeeping

- **House Status** `/unity/housestatus` — grouped by room type with pax rollup; columns Room Type/Room, Pax, **House Status** (inline dropdown: Dirty/Clean/…), **Assigned To** (inline housekeeper dropdown), **Room Status** (Vacant, Arriving Today, Pending Checkout, Checked Out, Out Of Order), Arrival Time, Arrival, Departure, Nights, Remarks, row edit; Print, Export, **Settings**, Audit Trail.
- **Maintenance Block** `/unity/maintenanceblock` — Room, Block From, Block To, Blocked On, Blocked By, Reason; Block Room, Export, Search.
- **Work Order / Task** `/unity/workorder` — Order #, Unit/Room, Reservation/Folio, Category, Description, Priority, Assign To, Entered On, Updated, **DeadLine**, Status; Add Task, Export, Search.

### A9. Night Audit

- **Run Night Audit**, **Night Audit Log**, **Insert Transaction**.
- Audit Trail slide-over: Date/Time, Log ("Night Audit — Old: 06/08/2026 New: 07/08/2026"), User, **IP address** — one row per business-date roll, searchable.
- **Insert Transaction** (back-dated stay entry): Check-in date+time, Check-out date+time, **N Nights** chip, Room(s) stepper, Booking Source, Business Source, Market Segment, Sales Person; **Rate Offered** block with Contract and Complimentary Room checkboxes; repeating room lines (Room Type, Rate Type, Room, Adult, Child, Rate($) tax-inclusive) + Add Room; Guest Information (title, name + guest picker, mobile, email, address, zip, country, state, city); right rail **Billing Summary** — Room Charges, Taxes, Due Amount, **Bill To**, **Tax Exempt**, Payment Mode.

### A10. B2B Marketplace — `/unity/b2bmarketplace`

- KPI tiles: Searches (last 30 days), **Availability Ratio %**, **Active Partners 1/7**, **Conversion %**.
- **Available Demand Channels** table: Partner, Searches, Availability %, Conversion %, Bookings, per-row **Improve** action; Download Report, period selector, **Optimize Distribution**.
- Partners tab: partner cards (Akbar Travels, TravClan, Agoda B2B, Travel World Solutions, Rezlive, Within Earth, Ottila, Go Global Travel "Coming Soon") with logo, View Detail, **commission slider 18%–50%** with numeric box, on/off Status toggle; header shows **Onboarding Pending — 50%**, Manage Promotion, Edit Rate Plan.

### A11. Referenced but not screenshotted (Part 01 only)

Net Locks (door-lock integration) · Reports · Exported Reports · Dashboard · Innalytics (BI) · Guest Statistics · Reputation Management · Revenue Management · Guest Portal (self check-in via res no + PIN) · User Activity · Configuration · Marketplace/add-ons.

### A12. Cross-cutting UX patterns worth cloning

1. **Right slide-over panels** for detail/edit instead of full page navigation.
2. **Counted filter chips / tabs** everywhere (All 8, Vacant 2, Arrivals 2 …).
3. **Audit Trail button on nearly every screen** — per-module, searchable, records user + IP.
4. **Export button on nearly every list**, plus an async "Exported Reports" queue.
5. **Inline-editable grid cells** with a dirty-state Save (rates/inventory/housekeeping).
6. **Sticky money footer** (Total / Paid / Balance) on any reservation surface.
7. **Sticky metric footer** on grids (Sold / Available / Total, Occupancy %).
8. Consistent **empty states** ("No data" illustration + primary CTA).
9. Source/channel identity carried visually everywhere (OTA logo chips).
10. In-product **release-notes feed with sentiment reactions** and notification centre.
