# YoHoBed 2.0 — Platform Monorepo

The modern rebuild of YoHoBed's B2B travel-distribution platform. This monorepo currently houses the
**PMS** (the property-owner Extranet rebuild) — the first compartment of the larger re-platform.

## Why this exists

The legacy Extranet runs on EOL Laravel 5.4 (with a CodeIgniter 3 staff portal) on one shared MySQL DB.
We are rebuilding it faithfully — reproducing the legacy pricing/tax/commission/availability/booking
logic exactly (proven by numeric parity tests) while fixing four known bugs — on a modern,
strongly-typed, AI-ready stack.

## Stack

TypeScript end-to-end · NestJS (modular monolith) · Next.js (App Router) + React + Tailwind + shadcn/ui ·
PostgreSQL + Drizzle · Redis + BullMQ · tRPC (internal) + OpenAPI (partners) · Claude + MCP · Turborepo + pnpm.

## Layout

```
apps/
  api           NestJS modular monolith (the PMS backend)
  web-extranet  Next.js — property-owner PMS
  web-staff     Next.js — minimal staff console
  worker        BullMQ workers (CM push, notifications)
  etl           MySQL -> Postgres migration + parity harness
packages/
  domain        framework-free pricing/tax/commission/inventory rules (parity core)  [IMPLEMENTED]
  db            Drizzle schema + migrations + tenant-scoping + RLS                    [IMPLEMENTED]
  contracts     tRPC + zod + OpenAPI contracts
  cm-adapter    channel-manager adapter (AxisRooms / RateGain, black-boxed)
  mcp           MCP tool surface over the domain services
  ui            design system (Tailwind preset + shadcn/ui)
  telemetry     OpenTelemetry / Sentry / Langfuse wiring
  testing       parity-validation harness
```

## The four legacy bugs being fixed

1. **Overbooking race** — legacy decrements inventory with no lock/transaction/floor. Fixed via atomic
   conditional `UPDATE ... WHERE rooms_to_sell >= n` inside the booking transaction.
2. **Walk-in wrong key** — legacy passes `room_id` where `occupancy_rate_plan_id` is expected. Fixed by
   resolving the correct key.
3. **Silent channel-sync failures** — legacy fire-and-forget pushes. Fixed via transactional outbox +
   BullMQ retries + dead-letter + alerting.
4. **Booking-reference race** — legacy `MAX(reference)+1`. Fixed via a Postgres sequence + UNIQUE constraint.

## Getting started

```bash
pnpm install
pnpm test        # domain parity suite (DB integration tests skip without DATABASE_URL)
pnpm typecheck

# Database (needs Docker running):
docker compose up -d                                   # Postgres :5433, Redis :6380
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/yohobed
pnpm --filter @yohobed/db db:generate                  # schema -> SQL migrations
pnpm --filter @yohobed/db db:migrate                   # apply migrations + RLS
pnpm --filter @yohobed/db test                         # proves tenant isolation (RLS)
```

Tenant isolation is enforced two ways: an application query-scope (`withTenant`) that sets
`app.tenant_id` per transaction, and Postgres **row-level security** policies that fence the
restricted `yoho_app` role to that tenant — so even an unscoped query cannot leak another
tenant's rows. This replaces the legacy session-trust + hardcoded admin-email backdoor.

## Status

**Phase 1 — Identity, Tenancy & RBAC (in progress).** See the full 12-phase plan in the project plan file.
Implemented: monorepo scaffold · `packages/domain` pricing core (parity tests) ·
`packages/db` identity/tenancy schema + tenant-scoping + RLS. Next: the NestJS `api` app
(auth + TenantContext guard).
