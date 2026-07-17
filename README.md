# YoHoBed 2.0 — Platform Monorepo

The modern rebuild of YoHoBed's B2B travel-distribution platform for Sri Lankan hospitality. This
monorepo houses the complete **PMS** (property-management system): the hotel-owner Extranet, the
YoHo staff console, the channel-manager distribution pipeline, and the pricing/tax/settlement
engine — a faithful, parity-tested rebuild of the legacy platform with its four known bugs fixed.

**Status: the legacy-parity MVP is feature-complete.** All planned build phases (0–8) and MVP
compartments (A–K) are done: owner PMS, staff console, OTA reservation inbox, front desk +
check-in/out, onboarding + email, photos, reviews/CRM, an API e2e test suite, CI, and a real
AxisRooms channel-manager adapter. 105 automated tests. What remains before launch is
infrastructure, not features — see [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md).

## Documentation

| Doc                                          | What it covers                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: apps, tenancy & RLS, security model, outbox pipeline, the four legacy bug fixes |
| [docs/API.md](docs/API.md)                   | Every HTTP endpoint, auth requirements, business rules, environment variables                  |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md)     | Every table, constraints, RLS status, DB helpers, migrations, seed data                        |
| [docs/PRICING.md](docs/PRICING.md)           | The money engine: commission, OTA gross-up, taxes, settlement — with worked examples           |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)     | Runbook: local dev, tests, CI, go-live checklists (email, AxisRooms), troubleshooting          |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md)     | **Hotel-owner guide** — every screen and daily workflow, in plain language                     |
| [docs/STAFF-GUIDE.md](docs/STAFF-GUIDE.md)   | YoHo staff console guide — tenant approval, oversight, audit                                   |
| [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) | Legacy vs 2.0 feature matrix and what's still to build                                         |

## Stack

TypeScript end-to-end · NestJS (modular monolith) · Next.js 14 (App Router) + React + Tailwind ·
PostgreSQL 16 + Drizzle ORM (with row-level security) · Redis 7 + BullMQ · Vitest ·
Turborepo + pnpm. AI seams (MCP) are designed in but not yet built.

## Layout

```
apps/
  api            NestJS modular monolith — the PMS backend            [BUILT]
  web-extranet   Next.js — owner PMS + staff console + public pages   [BUILT]
  worker         BullMQ — channel-manager push (outbox relay)         [BUILT]
  etl            MySQL -> Postgres migration + parity harness         [planned]
packages/
  domain         framework-free pricing/tax/commission engine         [BUILT]
  db             Drizzle schema + migrations + tenant scoping + RLS   [BUILT]
  cm-adapter     channel-manager adapters (AxisRooms real, fake dev)  [BUILT]
  contracts      tRPC + zod + OpenAPI contracts                       [planned]
  mcp            MCP tool surface over the domain services            [planned]
  ui / telemetry / testing                                            [planned]
```

## Quick start

Prerequisites: Node ≥ 22, pnpm 11.11, Docker Desktop.

```bash
pnpm install

# 1. Infrastructure (Postgres :5433, Redis :6380 — non-default ports)
docker compose up -d

# 2. Migrate + apply RLS + seed demo data (bash; see docs/OPERATIONS.md for PowerShell)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/yohobed
pnpm --filter @yohobed/db db:migrate
pnpm --filter @yohobed/db db:seed

# 3. API on :3001
cd apps/api
APP_DATABASE_URL=postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed \
JWT_SECRET=dev-secret-jwt-key-32-characters!! \
node dist/main.js        # after: pnpm build (from the repo root)

# 4. Web on :3000 (new terminal, repo root)
pnpm --filter @yohobed/web-extranet build
cd apps/web-extranet && node node_modules/next/dist/bin/next start -p 3000

# 5. Worker (optional — drains the channel-manager outbox)
pnpm --filter @yohobed/worker start
```

**Demo logins** (created by `db:seed`, password `password123` for both):

- Owner — `owner@demo.yohobed.test` → the PMS at `http://localhost:3000/app`
- YoHo staff — `staff@yohobed.test` → the staff console at `http://localhost:3000/staff`

The seed creates two demo properties: **Cinnamon Lakeside** (percentage commission, untaxed) and
**Ceylon Tax Villa** (slab commission + service charge + VAT), both priced through the engine.

## Tests

```bash
# Unit tests run anywhere; integration/e2e suites need the docker Postgres.
DATABASE_URL=postgres://postgres:postgres@localhost:5433/yohobed \
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/yohobed \
APP_DATABASE_URL=postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed \
JWT_SECRET=dev-secret-jwt-key-32-characters!! \
pnpm test
```

105 tests: 42 domain (pricing/tax parity) + 8 db (RLS isolation + concurrency proofs) +
36 API e2e (real HTTP against the real app under RLS) + 19 cm-adapter (AxisRooms wire contract).
CI runs the same pipeline on every push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## The four legacy bugs, fixed and regression-guarded

1. **Overbooking race** — legacy read-modify-write with no lock. Now an atomic conditional
   `UPDATE … WHERE rooms_to_sell >= n` plus a `CHECK (rooms_to_sell >= 0)` backstop
   (`packages/db/src/inventory.ts`). Proven by a 10-way concurrency e2e test.
2. **Walk-in priced on the wrong key** — legacy passed `room_id` where the occupancy/rate-plan id
   was expected. Bookings now carry an explicit `occupancyId`, validated against the room.
3. **Silent channel-sync failures** — legacy fire-and-forget HTTP. Every ARI change now writes a
   **transactional outbox** row in the same transaction; the worker retries with backoff and
   dead-letters loudly (`apps/worker`, `packages/cm-adapter`).
4. **Booking-reference race** — legacy `MAX(reference)+1`. Now an atomic per-day counter
   (`nextBookingReference`) + a UNIQUE constraint. Proven by a 12-way concurrency test.

## Tenant isolation

Enforced twice: the app's `withTenant` scope sets `app.tenant_id` per transaction, and Postgres
**row-level security** policies fence the restricted `yoho_app` role — an unscoped query cannot
leak another tenant's rows even if the application code forgets a filter. 33 tables carry the
policy; the handful that deliberately don't are documented in
[docs/DATA-MODEL.md](docs/DATA-MODEL.md). This replaces the legacy session-trust +
hardcoded-admin-email model.
