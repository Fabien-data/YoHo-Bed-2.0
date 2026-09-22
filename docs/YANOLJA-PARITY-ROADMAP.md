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
| 2      | 1 Front desk    | Room units + live migration            | ✅ **Done**    |
| 3      | 1 Front desk    | Stay View tape chart                   | ✅ **Done**    |
| 4      | 1 Front desk    | Room View, Reservations, Housekeeping  | ✅ **Done**    |
| 5      | 2 Money core    | Folio + charge posting                 | ✅ **Done**    |
| 6      | 2 Money core    | Cashiering, ledgers, POS               | 🟡 Partly¹     |
| 7      | 2 Money core    | Night audit                            | 🟡 Partly¹     |
| 8      | 3 Rates & dist. | The 7-tab ARI grid                     | ⏳ Next        |
| 9      | 3 Rates & dist. | Distribution + per-channel commission  | ⬜ Not started |
| 10–11  | 4 Reports       | Analytics + async export queue         | ⬜ Blocked²    |
| 12–13  | 5 Growth        | Guest portal, booking engine, payments | ⬜ Not started |
| 14+    | 6 AI            | MCP, Copilot, Revenue Manager, Healer  | ⬜ Not started |

¹ Re-graded by the 2026-08-28 pre-deployment audit — the core shipped and is tested, but the
sub-module list was never reconciled. See "The 2026-08-28 pre-deployment audit" below for
exactly what is missing from Sprints 1–7 and what the next phase must pick up.

² Sprint 10–11 blocked on receiving Yanolja Snapshots Part 02 — see "Open items" below.

### Development Phase 02 — Reservations (approved 2026-09-17)

The owner's brief (`Developement Phase 02/…Reservation_Section_Changes_and_Upgrades.pdf`, 21 Yanolja
screenshots) takes priority over Sprint 8. It rebuilds reservation **creation** and the reservation
list to Yanolja parity: Quick Reservation, the full Add Reservation page with its Billing Summary,
reservation types and holds, sources and segments, Bill To and invoices. It is built for Sri Lankan,
Malaysian and Indian hotels. Sri Lanka comes first; Malaysia and India money is the last sprint.
Every sprint deploys on its own.

| Sprint | Deliverable                                                           | Migration | Status         |
| ------ | --------------------------------------------------------------------- | --------- | -------------- |
| P2-S1  | Property profile, locale data, master lists, rate control             | `0027`    | ✅ **Live**³   |
| P2-S2  | Reservation engine: pricer, atomic multi-room create, holds lifecycle | `0028`    | ✅ **Live**⁴   |
| P2-S3  | UI kit pickers + Quick Reservation + entry points                     | —         | ✅ **Live**⁵   |
| P2-S4  | Full Add Reservation page + Reservations list rebuild                 | `0029`    | ✅ **Live**⁶   |
| P2-S5  | Payments at reservation, Bill To routing, walk-in check-in            | `0030`    | ✅ **Live**⁷   |
| P2-S6  | Vouchers, guest booking page, invoices (Sri Lanka profile)            | `0031`    | ✅ **Built**⁸  |
| P2-S7  | Malaysia & India money (MYR/INR, GST, SST, TTx) + Form C              | `0032`    | ⬜ Not started |

³ P2-S1 (2026-09-17) — live on yova.markui.lk since 2026-09-18 (`main@391be6e`, PR #4).

- **Configuration → Reservation setup.** Six tabs: property profile, reservation settings, business
  sources, market segments, payment methods, sales persons.
- **Master lists.** Seeded per tenant from the property's country, and a country preset can be
  added later.
- **Business sources.** Moved out of Pro-gated cashiering. Every plan can read them; owners write.
- **Rate control.** Owner step-up approval tokens (`POST /auth/step-up`).
- **Fixes.** Standalone tenants store plain rates with no gross-up. Booking references,
  dashboards and housekeeping now use the hotel's own date, not UTC.

⁴ P2-S2 (2026-09-18) — live since 2026-09-18 (PR #4). Before the deploy, the migrations were
rehearsed on a copy of the live database: bookings, amounts, folio charges, payments and
rooms-to-sell were unchanged. A fresh-database migrate on Postgres 16 (the server's version, and
CI's) needed `0020` and `0028` to compare `status` as text. The same error had kept CI red on `main` (last
seen in the 2026-08-29 run); PR #4's CI run passed.

- **Endpoints.** `POST /reservations` creates N rooms as N sibling bookings `<ref>-1…n` plus a group, all
  in one transaction, with an idempotency key. `POST /reservations/quote` returns the same price.
  `GET /properties/:id/room-availability` feeds the room grid.
- **Lifecycle.** Confirm, hold and release endpoints, per booking and per reservation.
- **Inventory flag.** `inventory_held` is generated by Postgres from status and kind, and every
  release and recount path keys off it. Holds are released on time by the worker (every minute)
  and by night audit. A no-show gives back the nights after the one it missed.
- **Pricing.** One pricer; the legacy path is pinned by a golden test. Typed rates (scaled
  base/commission, OTA margin never negative), contract rates (Pro), complimentary rooms and tax
  exemption. Staff limits are enforced with owner step-up approval.
- **Guests and rates.** Guest search and create with a duplicate check; local/foreign rate plans.
- **Open items.** The Quick Reservation UI arrives in S3. Early check-out still holds its
  remaining nights (to fix with S5 check-out). Hold-release emails wait for S6 templates, so the
  hotel is told in-app for now.

⁵ P2-S3 (2026-09-18) — live since 2026-09-18 (PR #4).

⁶ P2-S4 (2026-09-18) — live since 2026-09-18 (`main@a0154e3`, PR #5). The migration was rehearsed
on a copy of the live database first (every total unchanged), and `deploy.sh` took its own
pre-migration dump for the first time.

- **Add Reservation page** (`/app/reservations/new`, and "More options" from Quick Reservation):
  booking and business source, travel agent or company with voucher, segment, sales person; Rate
  Offered (contract, book all available, quick group booking, complimentary); per-room remarks,
  tasks, child ages and extra beds; Group Options including a pasted rooming list; guest address,
  nationality (resident or foreign rates) and ID document; a guest per room; Other Information;
  the live Billing Summary with tax exemption. One request saves it all.
- **Reservations list**: Upcoming and Booked-today tabs, type/source/segment/"taken by me"
  filters, server paging, Manage Columns (remembered), card view with pax icons, group cards with
  Merge Groups, a row menu, a reservation sheet (guests, remarks, tasks, documents, folio) and a
  server-side CSV of every row.
- **Migration 0029**: `booking_guests`, `guest_documents` (Aadhaar last-4 enforced by a CHECK),
  `booking_remarks`; `work_orders` gains booking, department and trigger. A test now fails if any
  new tenant table lacks RLS.
- **Fixed on the way**: Stay View drew overlapping unassigned and tentative stays on top of each
  other (a five-room group without room numbers looked like one booking); they now stack.

⁷ P2-S5 (2026-09-18) — live since 2026-09-19 (`main@6a081fb`, PR #6). The migration was rehearsed
on a copy of the live database first (every total unchanged); the server now has
`PRIVATE_FILES_DIR=/srv/yohobed/private` (yoho, 700), and the installed `backup.sh` archives it.

- **Payment Mode** in the Billing Summary: the hotel's own methods, amount (Full), reference where
  the method needs one, a slip photo or PDF in the new **private file store** (`GET /files/:id`,
  signed-in only, `no-store`; never `media`). Cash goes into the open drawer (**409**
  `drawer_closed` with cashiering on). A multi-room deposit is split by price under one gap-free
  receipt number (`RC26-00001`, `document_sequences`). City Ledger charges the agent or company.
- **Bill To**: guest, group owner, company (everything), or company for room and tax with extras
  routed to a guest window 2. Window payers and `routes` on `folios`.
- **Walk-in Check-in** button: a confirmed stay arriving today is saved and checked in, into the
  lowest free room of each type, with a dirty-room warning.
- **Inclusions** (per night, per guest, per adult/child, once; discount; in-rate) posted by night
  audit to the routed window, once per night; **pick-ups and drop-offs** with configurable
  transport modes, charged when marked done and voided when cancelled.
- **Check-out** (Pro) moves a company or travel agent window to its city ledger account and
  accrues the travel agent's commission (4 plan types, on room revenue net of tax).
- **Folio**: Take Payment uses the hotel's methods and slips; every window shows who it bills and
  every payment its receipt number and slip. ID scans can be attached to a guest's document
  (never for Aadhaar).
- **Open items.** A payment method in a foreign currency (Cash USD) is hidden until payments can be
  converted. Early check-out still holds its remaining nights.

⁸ P2-S6 (2026-09-20) — built and tested; not deployed yet.

- **Invoices.** A folio window (or a booking) is invoiced once. A Sri Lankan hotel with a TIN issues
  a TAX INVOICE for the VAT-able lines and a BILL for the rest, to Gazette 2481/22: serial
  `YYMMM-QQQQ-n`, supplier and purchaser TINs, MM/DD/YYYY dates, LKR equivalents on a
  foreign-currency invoice. Anyone else gets one INVOICE. Pro-formas quote a stay before it happens.
- **Corrections.** An issued document is never edited or voided; a credit note with a reason cancels
  it and frees the window. Numbers are gap-free per property from `document_sequences`, and an owner
  can continue a series from another system (forward only).
- **Voucher and guest page.** Preview and send the voucher (one email per recipient), a WhatsApp
  click-to-chat link, and a read-only guest booking page opened by an unguessable token — closed by
  the desk or 30 days after check-out, never indexed, and carrying no guest contact details.
  "Email booking vouchers" and "Send email at check-out" now actually send.
- **Also.** The registration card honours "Suppress rate" and lists inclusions. A folio window
  opened on demand now names its guest as payer (the Sprint 5 follow-up).
- **Migration 0031**: invoice columns + number unique per property + one live document per window,
  invoice line detail, `voucher_tokens` (no RLS, like `review_invites`).

- **UI kit.** Calendar, date/time pickers, stay row with an editable Nights chip, stepper,
  searchable combobox, phone and country inputs, inline alert, summary list and confirm dialog.
- **Quick Reservation.** A half-width sheet with a live quote, "N left" per room type, typed
  rates with reason and owner approval, returning-guest matching, hold release time, and an
  idempotent Reserve.
- **Entry points.** The header icon, Alt+N, the palette, a Stay View double-click, Room View's
  vacant rooms, and the Reservations and Bookings screens. The old walk-in sheet is gone.
- **Stay View.** Inquiries get a tentative lane, and holds carry a brass ring with their release
  time.
- **Fixes along the way.** API CORS now allows `Idempotency-Key`. `Select` drops Radix's
  empty-string echo.

### UX Excellence Program (approved 2026-09-22)

The owner shared Cloudbeds' 2025 "Hotel PMS User Experience" report, a survey of 500 hotel
employees. It is research, not a design spec, so we turned its findings into a binding
[UX-STANDARD.md](UX-STANDARD.md) with click budgets, safety rules and first-party measurement,
and a program that brings every screen up to it.

The owner's decisions:

- **Order:** safety first, then UX sprints alternate with feature sprints.
- **Training:** a practice hotel plus guided drills.
- **Support:** WhatsApp and an in-app email form.
- **Measurement:** first-party, with no guest data.

| Sprint | Deliverable                                                                                                                                                           | Status   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Hotfix | Only the owner can see or change payout details (PR #10)                                                                                                              | ✅ Built |
| UX-0   | The standard, click-budget tests, UX measurement + pulse survey + staff scoreboard, a real `/health`, request references, error screens, the Room View 3 s reload fix | ✅ Built |
| UX-1a  | Safe front desk, server side: check-in/out guards, undo and reinstate, reasons + actor on reversals, housekeeping carry-forward, night-audit pre-checks               | ⬜ Next  |
| UX-1b  | Safe front desk, UI: guided check-in/check-out, one booking-actions bar everywhere, change dates in-house                                                             | ⬜       |
| UX-2   | Find anything, do it from anywhere: universal search, palette actions, walk-in in one sheet, bulk actions, charge items                                               | ⬜       |
| UX-3   | Today board, alert engine, automations (scheduled audit, auto-assign, pre-arrival email)                                                                              | ⬜       |
| UX-4   | Always current and fast: live updates across desks, performance budgets, zero-downtime deploys                                                                        | ⬜       |
| UX-5   | Learn by doing: practice hotel, drills, tours, in-app help, WhatsApp/email support                                                                                    | ⬜       |
| UX-6   | Personal, role-aware, mobile: preferences, manager/night-auditor roles, housekeeper's phone view                                                                      | ⬜       |
| UX-7   | Reports that read themselves: daily manager flash, Excel export everywhere                                                                                            | ⬜       |

Feature sprints alternate between UX sprints: after UX-1 come P2-S7, then the Property Configuration
brief and then Sprint 8.

Locked rules:

- A multi-room reservation is **N sibling bookings** (`<ref>-1…n`) created in one transaction.
- Reservation **kind** is fixed in code. `bookings.inventory_held` gates every release.
- **One pricer** serves both quote and create. The legacy pricing path moves unchanged.
- **New maths goes in new files only.**
- ID scans and payment slips live in **private** storage.

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

> **✅ Shipped 2026-08-19.** Migration `0020_room_units`, applied additively — `rooms` keeps its
> meaning as the sellable bucket, so `availability_calendar`, `rate_plans`, `cm_room_mappings`,
> the outbox and `@yohobed/domain` are all untouched.
>
> New tables `room_units`, `booking_rooms`, `booking_groups`, `maintenance_blocks`, plus
> `bookings.group_id`. The migration back-fills in three steps: expand each `rooms.quantity` into
> property-wide numbered units (01..NN, interleaved across room types exactly as Yanolja's demo
> property is), emit one leg per physical room for every occupying booking, then greedily
> first-fit legs onto units. **A leg that finds no free unit is left unassigned rather than
> aborting** — legacy bucket data can be over-allocated, and a migration that refuses to run on
> real data is worthless.
>
> Rehearsed against the seeded database: 295 units from 295 bucket quantity across 59 properties,
> every property's unit count matching its bucket, 34 legs for exactly the occupying bookings
> (Cancelled correctly excluded, NoShow correctly included), zero unassigned, zero double-bookings.
>
> **Double-booking is now structurally impossible**, via a gist exclusion constraint on
> `(room_unit_id, daterange(checkin, checkout, '[)'))` where the leg is assigned and not released
> — the same class of guarantee as `rooms_to_sell >= 0`. Half-open ranges keep same-day turnover
> legal. Cancelling stamps `released_at` rather than nulling the unit, so the room frees up while
> the history survives; `NoShow` deliberately does not release.
>
> API in `apps/api/src/inventory/room-units.service.ts` + `room-units.controller.ts`:
> list/create/patch units, a bucket-vs-physical counts endpoint, `GET /bookings/:id/rooms`,
> `POST /bookings/:id/assign` and `auto-assign` (partial success reported). The booking lifecycle
> now creates legs on booking, releases them on cancel/reject, and un-assigns + re-shapes them on
> amend.
>
> Test count **213 → 234** (db 8→15, API e2e 78→92, plus the 16 Playwright).

**Sprint 3 — Stay View.** _Yanolja module A1 — the screen the product is judged on._

- API: one `GET /stayview?propertyId&from&to` returning room-type groups → units → bars, plus the
  per-date availability / rate / occupancy footer rows.
- New route `app/app/stayview/page.tsx`: virtualized tape chart; counted chips
  (All/Vacant/Occupied/Reserved/Blocked/Due Out/Dirty); date picker; group-by; rate-plan selector;
  15-day window with paging; hatched maintenance bars with Unblock/Edit context menu; hover card;
  right slide-over detail with sticky Total/Paid/Balance; Group Reservation List panel; footer
  Available Inventory + Occupancy %. Drag to move a booking between units; drag to extend a stay.
- **Acceptance:** 40 units × 90 days scrolls smoothly; moves write through and emit outbox events.

> **✅ Shipped 2026-08-19.** API `GET /stayview?propertyId&from&to` assembles the whole window
> server-side — room types → rooms → bars, per-date availability and rate, the metric footer and
> the counted chips — rather than making the browser stitch six endpoints together. Window capped
> at 120 nights. Plus maintenance-block CRUD (`POST /properties/:id/blocks`, `PATCH /blocks/:id`,
> `POST /blocks/:id/release`) behind the hatched-bar context menu.
>
> **Occupancy divides by SELLABLE rooms, not physical ones** — an 8-room property with 1 blocked
> and 5 sold reads 71% (5/7), not 63%. That is read straight off the Yanolja screenshots, where
> every occupancy figure in the strip divides by 7, and it is asserted in an e2e test so it cannot
> drift.
>
> **The chart deliberately does NOT use TanStack Virtual.** Each room is one relatively-positioned
> strip with the column rules painted as a repeating CSS gradient and bars placed absolutely on
> top; 40 rooms × 90 days is 40 elements, not 3,600. Virtualisation would add machinery to solve a
> problem this removes. Bars clip to the window with the cut edge squared off, so a stay running
> past the edge reads as continuing rather than as a short stay.
>
> Client-side chip filtering (the window is already loaded, so it is instant and costs no round
> trip) hides _rooms_, never bars. Clicking any bar opens the reservation slide-over with
> per-leg room assignment and auto-assign; clicking a block offers Unblock.
>
> Vitest 234 → **246** (API e2e 92→104). 5 Playwright specs for the chart are written but have
> **not been run yet** — verify with `pnpm --filter @yohobed/web-extranet e2e`. `dirty` is absent from
> the chips until housekeeping lands in Sprint 4 — a chip permanently reading 0 is worse than no
> chip.

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

> **🟡 Partly shipped 2026-08-19.** Migration `0021` adds `housekeeping_status` (one row per room
> per day, unique on `(room_unit_id, date)`) and `work_orders`, plus the guest-depth columns on
> `customers`. A **missing housekeeping row means clean** — rows are created lazily, so a 200-room
> hotel does not accrue 73,000 rows a year for rooms nobody touched.
>
> Room state (`Vacant / ArrivingToday / Occupied / PendingCheckout / OutOfOrder`) is **derived,
> never stored** — storing it would be a second source of truth that drifts the moment a booking
> is amended. Room View and House Status share one code path, so they cannot disagree.
>
> Two bugs found and fixed while testing. A guest departing **today** is excluded by the half-open
> stay overlap but is still in the room until they leave — so `PendingCheckout` needs its own
> query, and Stay View's `dueOut` count (which derived from the drawn bars) was **always 0 on the
> very date the chips describe**. Both now have dedicated queries and a regression test.
>
> The entitlement layer had a live landmine: a tenant with **no** subscription row resolves to
> deny-all, and no existing tenant had one. Migration `0022` grandfathers every existing tenant
> onto Enterprise, and registration now provisions a Starter trial. Housekeeping is in every plan
> (even a Starter hotel cleans rooms); **work orders are Pro and above**, gated per-method.
>
> Vitest 230 → **244** (API e2e 104 → 118: 14 housekeeping tests, and the deny-by-default billing
> test now asks for a subscription-less tenant explicitly via the new `plan: 'none'` fixture).
>
> **Completed 2026-08-21 — the Reservations rebuild.** `GET /reservations` returns one tab's rows
> **plus every tab's count**, because the numbers are the navigation: staff pick a tab _because_ it
> says 4, and a stale count sends them to an empty screen. A single `tabFilter` defines each tab
> for both the counts and the rows so the two cannot diverge. Search spans reference, guest name,
> email and phone — the four things a guest can actually quote at the desk.
>
> Groups write `bookings.group_id` and **nothing else**: each member keeps its own amount, folio
> and lifecycle, and the group total is a presentational sum, not a combined folio. That is what
> lets Yanolja's `3359-1` / `3359-2` presentation exist without touching pricing or settlement.
>
> Screens: `/app/reservations` (counted tabs, list ⇄ card views, debounced search, multi-select →
> Make Group, CSV export of what is on screen) and a printable GR registration card that prints
> through a scoped stylesheet rather than a PDF pipeline — it is one page of text, and
> `window.print()` gives the hotel their own paper and margin controls for free. The Guest Database
> screen gained a profile editor for the guest-depth fields and a VIP flag.
>
> One bug worth recording: `makeGroup` originally read its own work back through a fresh
> `withTenant`, which takes a **different connection** outside the still-uncommitted transaction —
> so the call 404'd on the group it had just created. Reads that follow a write in the same
> transaction must take the `tx`, not re-enter the pool.
>
> Also fixed a test-infrastructure fault this sprint exposed: the fixture harness upserted the
> global `plans` catalogue per tenant, so the parallel API suites contended over the same three
> rows and unrelated tests failed intermittently. The catalogue is now seeded **once** in
> `global-setup.ts`.
>
> Vitest 244 → **256** (API e2e 118 → 130).

### Phase 2 — Money core (Sprints 5–7)

**Sprint 5 — Folio + charge posting.** _Yanolja "Front Desk Operations"._
`folios`, `folio_charges`, `folio_payments`, `charge_particulars`, `folio_transfers`. Room charges
post from the existing `booking_days` snapshot — no new money math. Unsettled-folios screen, folio
window on the reservation slide-over, split/transfer bill.

> **✅ Shipped 2026-08-21.** Migration `0023`. One deviation from the plan above: there is **no
> `folio_payments` table**. `payments` already records what a guest paid — and the Stay View and
> Room View balance badges already read it — so it gained a nullable `folio_id` instead. A second
> payments table would have been a second answer to "is this settled?".
>
> **Room charges are copied from `booking_days`, never recomputed.** The snapshot is per room per
> night, so each line is multiplied by `bookings.rooms`; the posted lines sum to `bookings.amount`
> to the cent, which is asserted in a test. A folio that disagrees with settlement is the worst
> class of bug this system can have, so that equality is the load-bearing guarantee of the sprint.
>
> Posting is idempotent through a partial unique index on `(folio_id, booking_date)` where
> `source = 'room' AND voided_at IS NULL` — voided rows are excluded, so a wrongly-posted night can
> be reversed and re-posted while a double-post stays impossible.
>
> Extras follow the room rate's convention: a tax-inclusive price has its tax decomposed out of the
> total, so a bill never mixes tax-in and tax-on lines. Voiding stamps `voided_at` rather than
> deleting. Closing a window refuses a non-zero balance unless forced.
>
> Screens: `/app/folios` (unsettled, in-house first — a balance on a guest still in the building
> can be collected, one on a departed guest is already a debt) and a reusable `FolioPanel` that
> the Stay View reservation slide-over embeds, so the bill is one component and cannot disagree
> with itself.
>
> The harness gained a `taxed: true` fixture (10% service charge + 15% VAT, like the demo
> property), which is what lets the folio's tax handling be tested against the real engine.
>
> **Not done here on purpose:** automatic nightly posting. Room charges post on demand; the
> nightly roll belongs to night audit in Sprint 7, which is when the business date actually moves.
>
> Vitest 256 → **273** (API e2e 130 → 147).

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

### Interlude — the premium design pass (2026-08-24, between Sprints 7 and 8)

Before the ARI grid, the whole surface was re-skinned to the **"Ink Navy & Brass"** system —
light-first theme, IBM Plex, Phosphor icons, real motion, one `PageHeader`/one kit everywhere;
the legacy `components/ui.tsx` was deleted and `lucide-react` removed from the workspace. The
binding contract for every subsequent screen is [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md); per-screen
Yanolja-layout parity passes (Dashboard first) follow it. Verified: typecheck + build + 20
Playwright specs green.

### The 2026-08-28 pre-deployment audit

A full end-to-end audit (five parallel deep reviews: API, frontend, database, worker/infra/CI,
plan-vs-code) before the first production deployment. Everything below was verified against code,
not prose. All fixes landed the same day; suites green afterwards (db 15, domain 56, cm-adapter 22,
API e2e 173, worker 5, etl 31, Playwright 26 + 1 skipped).

**Critical bugs found and FIXED:**

1. **Overbooking via availability reset** — `openAvailability` wrote `rooms_to_sell` absolutely,
   resurrecting sold rooms; re-opening a month over 6 live bookings re-offered all 10 rooms. Now
   re-derived per date (requested − held by non-terminal bookings), with a regression e2e.
2. **Cross-tenant photo deletion** — `media`'s public-read policy ORs past `tenant_isolation`, so
   `DELETE /photos/:id` found a foreign row and destroyed the file on disk. All media reads now
   filter `tenant_id` explicitly; regression e2e added.
3. **Business date born in UTC** — `ensureBusinessDate` (and folio `postedFor` defaults) used
   `toISOString()`, a day behind for UTC+ properties until 05:30 local — the night-audit window —
   double-posting room charges. Now property-timezone via `localToday()`; postings default to the
   business date.
4. **Dead-letter replay was a permanent no-op** — BullMQ retains failed jobs under `jobId` and
   silently ignores re-adds, so the documented "re-set to pending" recovery looped forever. Now
   `removeOnFail: true` (the outbox row is the durable dead-letter record).
5. **Typo'd `CM_PROVIDER` selected the fake adapter** — which marks every push `sent` while
   syncing nothing. `resolveAdapter` now throws on any unrecognised value; contract tests added.
6. **Worker crash-loop on a Redis blip** — no `error` listeners on Worker/Queue (an unhandled
   `'error'` event kills the process; PM2 gives up after 10 restarts). Listeners added; env
   fail-fast in production (NODE_ENV now in provision.sh); Redis URL password/TLS/db honoured.

**High-severity fixed:** room charges double-posting after a bill-split transfer (dedupe is now
per-booking across windows, in both the folio service and night audit); amend leaving stale/
mispriced posted room charges (now voided/re-posted in the same transaction); the two payment
paths (`POST /bookings/:id/payments` now lands on window 1, so folio and reservation agree);
missing FX rate silently freezing foreign-currency bookings at 1:1 (now refuses with
`fx_rate_unavailable`); unbounded ARI date ranges (one request could write 357k rows — capped at
731 days); negative folio charges as invisible discounts (unitPrice ≥ 0; corrections go through
void); identity tables (`users`/`sessions`/`memberships`/`tenants`/`password_resets`) had **no
RLS** — policies added (unscoped auth flows see all, tenant scope is fenced); cashiering hardcoded
LKR breaking USD properties (defaults to the property currency; DTO validates the code); the
property switcher was decorative — six screens hardcoded the first property (now a shared
`useActiveProperty()` context); `toISOString()` "today" off-by-one on Dashboard/StayView/RoomView/
Reservations before 05:30 local (now `todayISO()`); silent `.catch(() => {})` rendering Rs 0.00
revenue / "No active subscription" / blank profile on network errors (now real error states);
night-audit duplicate-run race + no-show catch-up (`0026` unique index; `checkin <= date`);
`requeueStaleOutbox` looping exhausted rows and racing long backoffs (attempt ceiling added);
mailer double-send (atomic queued→sending claim; `POST /messages/:id/retry` added — the endpoint
OPERATIONS.md always claimed); Playwright now runs in CI (it never did); deploy.sh takes a
pre-migration `pg_dump` and health-checks the worker (a crash-looping worker used to deploy
"green"); entitlement gates added to Stay View (`stay_view`) and Room View (`room_view`), and the
command palette + header quick actions now respect entitlements like the sidebar.

Migration **`0026_audit_hardening`**: night-audit unique run index, `folio_charges` room-needs-
night CHECK, `booking_groups` unique code, `message_status` gains `'sending'`.

**Known gaps deferred to the next phase** (verified missing from "Done" sprints — the audit's
build list, roughly in value order):

1. **Housekeeping has no screen at all.** House Status grid, Work Orders and Maintenance Block
   screens are absent; the APIs and `lib/api.ts` clients exist unused. Work orders are a Pro-tier
   selling point with no UI. _Sprint 4 debt._
2. **POS / Incidental Invoice does not exist** (no table, route or screen) yet `pos: true` is
   sold on Pro/Enterprise. Ship it or pull it from the plan matrix. _Sprint 6 debt._
3. **Insert Transaction** (back-dated stay form) — absent entirely. _Sprint 7 debt._
4. Stay View interactions: drag-to-move, drag-to-extend, Group Reservation List panel, rate-plan
   selector (API param exists, no UI), create/edit maintenance block from the UI (only Unblock is
   wired), group-by dropdown, Assign Room toolbar action. _Sprint 3 debt._
5. Reservations: Merge Group (endpoint + client exist, no button), Individual/Group tab toggle,
   advanced search, inline Confirm, Total/Paid/Balance on cards. _Sprint 4 debt._
6. Cashiering depth: per-type Travel Agent / Company / Sales Person screens, Cashiering Center
   KPIs + opening/closing balance, expense voucher line items, Exchange Rate editor UI for
   `POST /fx/override` (staff have no way to set the override the FX fallback now depends on).
7. `business_sources` is inert — `bookings.business_source_id` is written nowhere and Stay View
   colours by status, not source. The colour-coded tape chart the schema was built for is
   unreachable.
8. **Night audit is manual-only** — nothing schedules it and nothing alarms when the business
   date falls behind; drift is invisible until reconciliation fails. Needs a scheduled run or a
   staleness alert (plus the audit-drift no-show catch-up now in place).
9. **No monitoring/alerting anywhere** — worker `[ALERT]` lines go to a rotated PM2 log; backup
   failures are silent; `/health` checks nothing real. First ops sprint after launch.
10. Plan **limits** (`max_properties`, `max_rooms`) are resolved and displayed but enforced
    nowhere; `channel_manager` / `guest_messaging` / `reports_advanced` endpoints carry no
    `@Feature` gates. JWT memberships have no revocation until expiry (1d).
11. `scripts/demo-data.mjs` predates Sprints 2–7: a demo database shows an empty Stay View,
    Folios, Cashiering, Housekeeping and Night Audit. Extend it before the next client demo.
12. Email in production: `provision.sh` writes `EMAIL_PROVIDER=console`, and messages are marked
    `sent` while going nowhere. Deliberate until Resend credentials land — but switching it on is
    a go-live checklist item, not a code change.
13. Docs drift: ARCHITECTURE.md §7/§8 counts, USER-GUIDE.md (predates Sprints 1–7), API.md's
    missing `fx` module, OPERATIONS.md test counts. Sweep once Sprint 8 lands.

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
