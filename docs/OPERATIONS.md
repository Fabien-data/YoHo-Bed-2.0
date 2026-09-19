# YoHoBed 2.0 — Operations Runbook

> Local development, tests, CI, and the go-live checklists. Commands are given for **bash** and,
> where syntax differs, **PowerShell** (the primary dev machine is Windows).
>
> Companion docs: [API.md](API.md) (env-var reference) · [ARCHITECTURE.md](ARCHITECTURE.md)

## 1. Prerequisites

- Node ≥ 22, pnpm 11.11 (`packageManager` pin), Docker Desktop, git.
- First install: `pnpm install`. Native build scripts are allow-listed in
  `pnpm-workspace.yaml` (`esbuild`, `@swc/core`); if pnpm reports ignored build scripts, add the
  package there rather than approving ad hoc.

## 2. Local bring-up (in order)

```bash
# 1. Infrastructure — Postgres :5433, Redis :6380 (NON-default ports; data persists in a volume)
docker compose up -d

# 2. Migrations + RLS + seed (as the postgres OWNER — bypasses RLS by design)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/yohobed
pnpm --filter @yohobed/db db:migrate     # applies drizzle/ migrations, then rls.sql
pnpm --filter @yohobed/db db:seed        # demo logins + two demo properties (idempotent)

# 3. Build everything once
pnpm build

# 4. API (:3001) — connects as the RESTRICTED yoho_app role, so RLS is always on
cd apps/api
APP_DATABASE_URL=postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed \
JWT_SECRET=dev-secret-jwt-key-32-characters!! \
WEB_URL=http://localhost:3000 \
node dist/main.js

# 5. Web (:3000)
cd apps/web-extranet && node node_modules/next/dist/bin/next start -p 3000

# 6. Worker (only needed to see channel-manager pushes drain)
APP_DATABASE_URL=postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed \
REDIS_URL=redis://localhost:6380 \
pnpm --filter @yohobed/worker start
```

PowerShell equivalents set env per-session, e.g.:

```powershell
$env:APP_DATABASE_URL = "postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed"
$env:JWT_SECRET = "dev-secret-jwt-key-32-characters!!"
Set-Location "apps\api"; node dist/main.js
```

**Demo logins** (from the seed): owner `owner@demo.yohobed.test` / `password123` →
`http://localhost:3000/app`; staff `staff@yohobed.test` / `password123` →
`http://localhost:3000/staff`. The login page pre-fills the owner credentials — a deliberate
demo convenience to remove before public hosting.

### Two database roles — never mix them up

| Role                    | URL                                  | Used by                                    | RLS          |
| ----------------------- | ------------------------------------ | ------------------------------------------ | ------------ |
| `postgres` (owner)      | `DATABASE_URL` / `TEST_DATABASE_URL` | migrations, seed, test fixtures            | bypassed     |
| `yoho_app` (restricted) | `APP_DATABASE_URL`                   | the API, the worker, everything at runtime | **enforced** |

`rls.sql` creates `yoho_app` (password `yoho_app_pw` in dev) and applies the `tenant_isolation`
policies. It re-runs on every `db:migrate`, idempotently.

## 3. Tests

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/yohobed \
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/yohobed \
APP_DATABASE_URL=postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed \
JWT_SECRET=dev-secret-jwt-key-32-characters!! \
pnpm test
```

302 Vitest tests across six suites (domain 56, db 15, api e2e 173, cm-adapter 22, etl 31,
worker 5), plus the 27 Playwright specs below. Notes that matter:

- **Turbo strict env mode:** `turbo.json`'s `test.env` allow-list is what passes
  `DATABASE_URL` & friends through to the suites. Without it the db/api integration tests would
  silently **skip** — which is why they also `throw` if `CI` is set and `DATABASE_URL` isn't:
  a green CI run that proved nothing is the failure mode this guards against.
- The db suites use the docker Postgres directly (no Testcontainers); the api e2e harness boots
  the real Nest app in-process (SWC transform for decorator metadata) and provisions an isolated
  tenant per suite, so runs never collide with the seed or each other.
- The api e2e defaults live in `apps/api/test/global-setup.ts` — running
  `pnpm --filter @yohobed/api test` locally works with just docker up.
- Per-package: `pnpm --filter @yohobed/domain test` (no DB needed) · `--filter @yohobed/db test`
  · `--filter @yohobed/api test` · `--filter @yohobed/cm-adapter test` (no DB needed).

### Browser E2E (Playwright)

```bash
pnpm build                                   # both servers run built output
pnpm --filter @yohobed/web-extranet e2e      # or `e2e:ui` for the interactive runner
```

27 tests in `apps/web-extranet/e2e/` (every nav route smoke-rendered, plus the Stay View specs).
**These run in CI too** (a `playwright install` + `e2e` step after migrate/seed/build) — they are
the only coverage the browser layer has. `playwright.config.ts` starts the API and the web app
itself; the one prerequisite is a migrated, seeded database. Two things it has to work around,
both of which fail _silently_ if you change them:

- **`NEXT_PUBLIC_API_URL` is inlined at build time.** Setting it on the `next start` command does
  nothing — the bundle already contains the value from `next build`. The API therefore runs on
  **3001**, the port baked into the default, rather than a port the test config picks.
- **CORS.** The API allows `http://localhost:3000` unless told otherwise, so the config passes
  `CORS_ORIGINS` for the Playwright origin. Without it every authenticated request is blocked and
  only the logged-out tests pass.

### Running the DB suites without Docker

When Docker Desktop is unavailable, a throwaway cluster from a local PostgreSQL install works just
as well — and on the same port, so no config changes are needed. On Windows with PostgreSQL 17
installed (`C:\Program Files\PostgreSQL\17\bin`):

```bash
PGBIN="/c/Program Files/PostgreSQL/17/bin"
PGDATA='C:\path\to\scratch\pgdata'          # MUST be a Windows path, not /c/...
"$PGBIN/initdb.exe"  -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8
"$PGBIN/pg_ctl.exe"  -D "$PGDATA" -o "-p 5433" -l "$PGDATA\..\pg.log" start
"$PGBIN/psql.exe" -h 127.0.0.1 -p 5433 -U postgres -c "CREATE DATABASE yohobed;"
# …then migrate/seed/test exactly as above, and finally:
"$PGBIN/pg_ctl.exe"  -D "$PGDATA" stop -m fast
```

Three traps. Give `initdb`/`pg_ctl` a **Windows** path — a git-bash `/c/…` path is resolved against
the _current drive_, so it silently builds the cluster somewhere like `D:\c\Users\…`. `pg_ctl start`
does not return control in git bash, so background it and poll the port instead of waiting on it.
And use `127.0.0.1`, never `localhost` (§6). A separately installed PostgreSQL **service** on :5432
is not a substitute unless you know its `postgres` password — the scratch cluster uses trust auth
precisely to sidestep that.

## 4. CI (`.github/workflows/ci.yml`)

Every push to `main` and every PR runs one `verify` job on `ubuntu-latest` with Postgres 16 +
Redis 7 service containers: install (frozen lockfile) → **build** → **db:migrate** →
**db:seed** → **typecheck** → **test** (all six suites) → **format:check** (Prettier;
generated files are excluded via `.prettierignore` — never hand-format `pnpm-lock.yaml` or
`packages/db/drizzle/`).

## 5. Go-live checklists

### 5.1 Real email (Resend)

1. Set on the API: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<key>`,
   `EMAIL_FROM="YoHoBed <no-reply@yourdomain>"` (verified domain), `WEB_URL=<public web origin>`
   (reset/review links are built from it).
2. Nothing else changes: messages queue in the `messages` table and drain post-commit; provider
   failures mark rows `failed` (visible in Comms) without breaking bookings.
3. Verify: register a test owner → "registration received" email arrives; approve in the staff
   console → welcome email; book + check out → confirmation + review invite.

### 5.2 Real channel manager (AxisRooms)

1. **Drain the outbox first** while still on the fake provider
   (`SELECT status, count(*) FROM outbox GROUP BY status;` — wait for no `pending`). Rows
   enqueued before Compartment K lack `propertyId` and the adapter **refuses** them rather than
   posting a half-empty payload.
2. Set on the worker: `CM_PROVIDER=axisrooms`, `CM_URL_AXISROOMS=<core service base URL>`,
   `AXISROOMS_CHANNEL_ID=164`, optional `CM_AXISROOMS_API_KEY`, and the
   `CM_AXISROOMS_*_ENDPOINT` overrides if the core service's paths differ from the defaults.
   The worker refuses to boot if `axisrooms` is selected without a URL — silently pretending to
   sync is the worst failure mode.
3. Set on the API: a strong `CM_WEBHOOK_SECRET` (share it with the channel manager for the
   inbound `POST /cm/reservations`; header `x-cm-secret`).
4. Map every room to its CM code (owner Inbox screen, or `PUT /ota/mappings`) — unmapped codes
   are rejected `422` so the CM retries.
5. Watch: worker logs (`[ALERT]` = a push dead-lettered after 5 attempts) and
   `GET /distribution/health`. The wire contract is pinned by 19 adapter tests — a green
   `pnpm --filter @yohobed/cm-adapter test` means only config can be wrong.

### 5.3 Secrets & security

- Rotate `JWT_SECRET` (min 16 chars — boot fails otherwise) and `CM_WEBHOOK_SECRET`; change the
  `yoho_app` password from the dev default in both Postgres and `APP_DATABASE_URL`.
- Set `CORS_ORIGINS` to the public web origin.
- Remove the login page's pre-filled demo credentials and don't run `db:seed` in production
  (real tenants register self-serve; staff users are inserted manually).
- `MEDIA_DIR` must be on persistent storage (or swap the `StorageAdapter` for S3 when built).
- `PRIVATE_FILES_DIR` (payment slips and ID scans, Development Phase 02) must be on persistent
  storage too, **outside** `MEDIA_DIR` and the app checkout, owned by the runtime user with mode
  700 — on the VPS `/srv/yohobed/private`, created by `provision.sh` and archived by `backup.sh`.
  Unset, it defaults to `./private-files` under the API's working directory, which a redeploy of
  the checkout does not wipe but no backup covers.

## 6. Troubleshooting

| Symptom                                              | Cause / fix                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API exits at boot: `Invalid environment: JWT_SECRET` | The secret is under 16 chars — the env schema fails fast by design.                                                                                                                                                            |
| API boots but every list is empty                    | You connected as `postgres` instead of `yoho_app`… or vice versa: no tenant context + RLS = zero rows. Check `APP_DATABASE_URL`.                                                                                               |
| `docker compose up` fails / API can't reach the DB   | Docker Desktop isn't running (it doesn't auto-start between sessions). Start it, then `docker compose up -d`.                                                                                                                  |
| `EADDRINUSE :3000` when restarting the web app       | A previous `next start` left an orphan. Start Next via `node node_modules/next/dist/bin/next start` (stops cleanly), or free the port: `Get-NetTCPConnection -LocalPort 3000 \| Select -Expand OwningProcess \| Stop-Process`. |
| Demo room/occupancy IDs changed after reseeding      | Expected: the seed resets the demo tenant deterministically. Re-read the IDs from the seed output.                                                                                                                             |
| db/api tests all "skipped"                           | `DATABASE_URL` didn't reach the suite — run through `pnpm test` with the env set (Turbo passes it through), or set it inline for a single package.                                                                             |
| Worker floods `missing 'propertyId'` retries         | Stale pre-K outbox rows met the AxisRooms adapter. Delete or let them dead-letter; see checklist 5.2 step 1.                                                                                                                   |
| CM push permanently failed (`[ALERT]`)               | The core service rejected/was down for all 5 attempts. Row sits in `outbox` with `status='failed'` + `last_error`; fix the cause and re-set to `pending` to replay.                                                            |

## 7. Day-to-day conventions

- **Commits** at the `yohobed2` repo root only; never commit the legacy `extranet/` or
  `backend-portal/` trees (they live outside this repo on purpose).
- Money is LKR everywhere; dates are `YYYY-MM-DD` (UTC) at the API boundary.
- New tenant-owned tables must: carry `tenant_id`, get a `tenant_isolation` policy in
  `rls.sql`, and be written through `withTenant`. Deliberate exceptions need a comment in
  `rls.sql` explaining why (see `outbox` / `cm_room_mappings` / `review_invites`).
- New guest-facing emails: insert a `messages` row (status `queued`) inside the business
  transaction, then `mailer.deliverQueuedSafe(tenantId)` after commit — never `await` a
  provider call inside the transaction.
