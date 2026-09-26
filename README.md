<div align="center">

# YoHoBed 2.0

**A multi-tenant hotel property-management system (PMS) and channel manager, built as subscription SaaS.**

[![CI](https://github.com/Fabien-data/YoHo-Bed-2.0/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Fabien-data/YoHo-Bed-2.0/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-API-E0234E?logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20RLS-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white)
![Tests](https://img.shields.io/badge/tests-650%2B%20Vitest%20%C2%B7%2065%20Playwright-2E7D32)
![License](https://img.shields.io/badge/license-proprietary-555555)

[**Live demo**](https://yova.markui.lk) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) ·
[Data model](docs/DATA-MODEL.md) · [Demo walkthrough (PDF)](docs/DEMO-WALKTHROUGH.pdf)

![Stay View — the front-desk booking calendar](docs/images/stayview.png)

</div>

## What it is

YoHoBed 2.0 runs the whole day of a hotel: reservations, the front desk, housekeeping, cashiering,
the night audit, invoicing and payouts. It also pushes rates and availability to online travel
agencies through a channel manager. Many hotels share one deployment, and PostgreSQL row-level
security keeps each hotel's data apart.

It replaces a legacy CodeIgniter + Laravel 5.4 platform. The rebuild is parity-tested against the
old system's money rules, and it fixes the four known bugs in the legacy platform.

## Screenshots

| Dashboard                                                                                    | Room View                                                                                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![Dashboard: today's arrivals, departures, occupancy and revenue](docs/images/dashboard.png) | ![Room View: every room's occupancy and housekeeping state, with the cleaning queue](docs/images/roomview.png) |
| **Reservations**                                                                             | **Stay View**                                                                                                  |
| ![Reservations list with balances and statuses](docs/images/reservations.png)                | ![Stay View calendar: drag-and-drop bookings across rooms and dates](docs/images/stayview.png)                 |

## Highlights

- **Stay View command centre:** a room-by-date booking calendar with drag-to-move, safe room moves,
  split stays, group and block bookings, and live updates to every open screen over Server-Sent
  Events.
- **Full front desk:** guided check-in and check-out, walk-ins, Room View and Floor View,
  housekeeping tasks and a cleaning queue.
- **Money done carefully:** folios, cashiering, night audit, gap-free invoice numbering, credit
  notes, and country tax engines for Sri Lanka, Malaysia and India. Every payout statement
  reconciles to the cent.
- **Multi-currency:** USD or LKR as each property's base currency, with automatically fetched
  exchange rates.
- **Reliable distribution:** every rate and availability change writes a transactional outbox row.
  A worker delivers it to the channel manager (AxisRooms), retries with backoff and dead-letters
  failures loudly.
- **Tenant isolation enforced by the database:** Postgres row-level security fences every tenant
  table, so a query that forgets its filter still cannot read another hotel's data.

## Architecture

```mermaid
flowchart LR
    Browser["Browser<br/>(hotel staff and owners)"] --> Nginx[nginx]
    Nginx -->|"/"| Web["web-extranet<br/>Next.js 14"]
    Nginx -->|"/api"| API["api<br/>NestJS modular monolith"]
    API -. "live updates (SSE)" .-> Browser

    API --> Domain["packages/domain<br/>pricing · tax · commission"]
    API --> DB[("PostgreSQL 16<br/>row-level security")]
    API --> Redis[("Redis 7")]

    DB -->|"transactional outbox"| Worker["worker<br/>BullMQ"]
    Redis --- Worker
    Worker --> CM["packages/cm-adapter"]
    CM --> AxisRooms["AxisRooms<br/>channel manager"]
    AxisRooms --> OTAs["OTAs<br/>Booking.com, Agoda …"]
    Worker --> FX["Exchange-rate feed"]
```

The API is one NestJS app split into feature modules (reservations, stay view, cashiering, night
audit, housekeeping, finance and more). The pricing, tax and commission rules live in
`packages/domain` with no framework code, so they can be tested in isolation. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Project status

**Status: the legacy-parity MVP is feature-complete; the Yanolja-parity PMS program is underway.**
All original build phases (0–8) and MVP compartments (A–K) are done: owner PMS, staff console, OTA
reservation inbox, front desk + check-in/out, onboarding + email, photos, reviews/CRM, an API e2e
suite, CI, and a real AxisRooms channel-manager adapter.

The current work is rebuilding this into a **full hotel PMS at feature parity with Yanolja Cloud
Solution**, sold as subscription SaaS — see
[docs/YANOLJA-PARITY-ROADMAP.md](docs/YANOLJA-PARITY-ROADMAP.md) for the sprint plan and status.

## Documentation

| Doc                                                              | What it covers                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [docs/YANOLJA-PARITY-ROADMAP.md](docs/YANOLJA-PARITY-ROADMAP.md) | **The sprint plan.** Every sprint, its scope and status, plus the full Yanolja PMS feature inventory |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                     | System design: apps, tenancy & RLS, security model, outbox pipeline, the four legacy bug fixes       |
| [docs/API.md](docs/API.md)                                       | Every HTTP endpoint, auth requirements, business rules, environment variables                        |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md)                         | Every table, constraints, RLS status, DB helpers, migrations, seed data                              |
| [docs/PRICING.md](docs/PRICING.md)                               | The money engine: commission, OTA gross-up, taxes, settlement — with worked examples                 |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)                         | Runbook: local dev, tests, CI, go-live checklists (email, AxisRooms), troubleshooting                |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md)                         | **Hotel-owner guide** — every screen and daily workflow, in plain language                           |
| [docs/STAFF-GUIDE.md](docs/STAFF-GUIDE.md)                       | YoHo staff console guide — tenant approval, oversight, audit                                         |
| [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md)                     | Legacy vs 2.0 feature matrix and what's still to build                                               |

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
  ui             design system — Radix + TanStack, source-only          [BUILT]
  telemetry / testing                                                   [planned]
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

About 650 Vitest tests: ~140 domain (pricing/tax parity + entitlements), ~30 db (RLS isolation +
concurrency proofs), ~390 API e2e (real HTTP against the real app under RLS), ~20 cm-adapter
(AxisRooms wire contract), ~30 etl, ~27 locale and a handful of worker tests. CI runs the same
pipeline on every push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

Plus 65 Playwright browser tests across 16 specs —
`pnpm --filter @yohobed/web-extranet e2e` (needs `pnpm build` and a seeded database first).

Docker Desktop is the documented route, but the DB-backed suites also run against a throwaway
cluster built from a local PostgreSQL install — see [docs/OPERATIONS.md](docs/OPERATIONS.md).

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
leak another tenant's rows even if the application code forgets a filter. 80 tables carry the
policy; the handful that deliberately don't are documented in
[docs/DATA-MODEL.md](docs/DATA-MODEL.md). This replaces the legacy session-trust +
hardcoded-admin-email model.
