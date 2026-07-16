# YoHoBed 2.0 — Consolidated Gap Analysis & Next-Move Board

**Date:** 2026-07-13 · **Sources:** full code inventory of `extranet/` (Laravel 5.4 owner extranet), `backend-portal/` (CI3 staff/admin portal + the gitignored core.yohobed.com microservices described in its context.md), `_extranet_docs_build/` (YB-Suit architecture docs), and `yohobed2/` (the new monorepo, Phases 0–8 + MVP compartments A–F complete).

**Purpose:** one place that answers _"what's left?"_ across four categories: ① legacy parity gaps, ② new must-adds, ③ AI/MCP revamp features, ④ other platform components. Ends with sequencing options for the next-move discussion.

---

## 0. Where we stand (snapshot)

**YoHoBed 2.0 today** is a working single-property-owner PMS: auth + JWT + tenant RLS, property/room/roomtype setup, rate plans + occupancies + seasons + last-minute drops, month rate/availability calendar with inline editing, walk-in bookings with full lifecycle (approve/reject/cancel/no-show), tax + slab-commission parity engine (42 domain tests), invoices/payments/payout settlement that reconciles to the cent, promotions/coupons/referrals, notifications + multilingual templates, OTA reservation inbox (webhook + retry), transactional outbox → BullMQ worker → CM adapter seam, and a minimal cross-tenant staff console. **All 4 legacy bugs are fixed and proven.**

**What it is not yet:** connected to a real channel manager, loaded with real data, able to send a real email/SMS, hosted anywhere, or carrying any AI. And a real hotel can't fully run on it yet — no dashboard, no check-in/check-out, no photos, no reviews, no bank-details/onboarding flow.

Legend: ✅ built · 🟡 partial · ❌ missing · 🚫 deliberately dropped/replaced · 🆕 net-new (no legacy equivalent)

---

## 1. Side-by-side matrix

### 1a. Owner Extranet (legacy Laravel `extranet/` vs `yohobed2`)

| #   | Legacy feature area                           | Legacy detail                                                                                                                                                  | YoHoBed 2.0 status                                                                                                    |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Login / forgot / reset password               | Laravel auth                                                                                                                                                   | ✅ (JWT; reset email is a console stub)                                                                               |
| 2   | Self-registration                             | `register` route                                                                                                                                               | ❌ intentionally not exposed — needs a designed onboarding flow                                                       |
| 3   | Lock screen                                   | lock/unlock                                                                                                                                                    | 🚫 dropped (obsolete pattern)                                                                                         |
| 4   | Locale switch en/si/ta                        | `set-locale`, si/ta lang files                                                                                                                                 | 🟡 languages + per-language templates exist; **UI itself is English-only**                                            |
| 5   | **Dashboard (3 personas)**                    | today's check-ins/outs, stay-overs, recent bookings, pending count, open/sold-out status, monthly revenue; group/chain master dashboard with property switcher | ❌ **no dashboard at all** — nav starts at Calendar                                                                   |
| 6   | Bookings: create/list/view                    | manual booking + live availability + quote                                                                                                                     | ✅                                                                                                                    |
| 7   | Bookings: approve/reject/cancel/no-show       | via cleartext cURL bridge to backend                                                                                                                           | ✅ (self-contained, bridge killed)                                                                                    |
| 8   | Bookings: **check-in / check-out**            | checked-in, checked-out, check-guest-in                                                                                                                        | ❌                                                                                                                    |
| 9   | Bookings: **edit/amend**                      | edit dates/rooms/guest                                                                                                                                         | ❌ (create + lifecycle only)                                                                                          |
| 10  | Bookings: save guest email on booking         | `save-email`                                                                                                                                                   | ❌ (customer email captured at create only)                                                                           |
| 11  | Rate/availability calendar                    | date-range grid, price + rooms-to-sell                                                                                                                         | ✅ (better: month wall-calendar, inline edit)                                                                         |
| 12  | Open/close dates, rooms-to-sell, price update | incl. bulk range ops                                                                                                                                           | ✅                                                                                                                    |
| 13  | Seasons                                       | create season + apply                                                                                                                                          | ✅                                                                                                                    |
| 14  | Last-minute price drops                       | % drop with delete                                                                                                                                             | ✅                                                                                                                    |
| 15  | **ARI / price-change history**                | `ari-history` audit screen for owners                                                                                                                          | ❌ (audit_log exists but staff-only; no owner-facing history)                                                         |
| 16  | **Excel bulk upload (ARI)**                   | queued job + email result                                                                                                                                      | ❌                                                                                                                    |
| 17  | Flexi AM/PM rooms-to-sell                     | split-day inventory                                                                                                                                            | 🚫 dropped (niche; revisit only if real usage found in data)                                                          |
| 18  | Min/max stay restrictions                     | backend `chanage_min_max`                                                                                                                                      | ❌ (no stay restrictions in 2.0 at all — also no CTA/CTD)                                                             |
| 19  | **Room photos**                               | upload + CDN display                                                                                                                                           | ❌ no image/media handling anywhere in 2.0                                                                            |
| 20  | Connected OTAs view                           | property_ota list                                                                                                                                              | 🟡 CM room-code mappings exist in Inbox; no owner "my channels" screen                                                |
| 21  | Channel-manager request flow                  | form → email to staff                                                                                                                                          | ❌                                                                                                                    |
| 22  | **Reviews**                                   | guest reviews shown to owner                                                                                                                                   | ❌                                                                                                                    |
| 23  | Finance: balance / settlement                 | USD commissionable totals, YOHO+OTA commission, net payable                                                                                                    | ✅ (payout statement, reconciles; **LKR only — no multi-currency**)                                                   |
| 24  | Finance: invoices per reservation             | list + view                                                                                                                                                    | ✅ (no PDF export)                                                                                                    |
| 25  | Promotions / deals                            | % deals per property + window                                                                                                                                  | ✅ (plus apply-to-calendar)                                                                                           |
| 26  | Referral bookings                             | iframe to yohobed.com                                                                                                                                          | ✅ reimagined: referral partners + commissions (better)                                                               |
| 27  | Customer view/edit                            | customer page                                                                                                                                                  | 🟡 customers stored; no customer screen/CRM view                                                                      |
| 28  | **Profile / bank details / agreement**        | payout bank details, property agreement acceptance, change password                                                                                            | ❌ — bank details matter: settlement has nowhere to pay to                                                            |
| 29  | Messaging to YOHO/guests                      | send message via core endpoint                                                                                                                                 | 🟡 outbound message log + templates exist; **no real send (email/SMS providers stubbed)**, no two-way guest messaging |
| 30  | Notifications                                 | ex_notifications from staff                                                                                                                                    | ✅ in-app notifications + bell                                                                                        |
| 31  | Help / training video / how-to-pay            | static pages                                                                                                                                                   | ❌ (trivial)                                                                                                          |
| 32  | Email→role admin backdoor                     | hard-coded allow-list                                                                                                                                          | 🚫 replaced by real RBAC (memberships + guards)                                                                       |

### 1b. Staff/Admin backoffice (legacy CI3 `backend-portal/` vs 2.0 `/staff`)

2.0's staff console is deliberately minimal (locked decision: full owner PMS + minimal staff console). Gaps here are mostly _chosen_ scope, listed so we can consciously schedule or kill each one.

| #   | Legacy backoffice area                                                                                                           | YoHoBed 2.0 status                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 33  | Tenant list, cross-tenant booking approvals, suspend/activate, audit trail                                                       | ✅                                                                                                        |
| 34  | **Property onboarding by staff** (create property, images, amenities, attractions, categories)                                   | ❌ — currently owners self-create bare properties only                                                    |
| 35  | Reference-data admin (cities, amenity types, property types, room types, rate codes, tax types/durations, cancellation policies) | ❌ (rate codes + taxes are seed-only)                                                                     |
| 36  | OTA master + property↔OTA linkage + per-OTA commission %                                                                         | ❌ (OTA commission hardcoded 18% default)                                                                 |
| 37  | Commission structures / slabs admin UI                                                                                           | 🟡 slabs work in engine; no admin UI                                                                      |
| 38  | PRS rate-sheet Excel exports per OTA                                                                                             | ❌                                                                                                        |
| 39  | Data matrix / property analytics                                                                                                 | ❌                                                                                                        |
| 40  | Admin users + module/field-level permissions                                                                                     | 🟡 role enum only (OWNER/OWNER_STAFF/YOHO_STAFF/YOHO_ADMIN); no user-management UI, no fine-grained perms |
| 41  | Revenue-team booking reconciliation                                                                                              | ❌                                                                                                        |
| 42  | Staff invoicing: outstanding invoices, payment send/received                                                                     | 🟡 payments/invoices exist owner-side; no staff finance ops view                                          |
| 43  | Currency table + USD rate updates                                                                                                | ❌ (LKR-only display)                                                                                     |
| 44  | Staff notifications engine (rate-expiration digests, competitive alerts, push-to-all via OneSignal)                              | ❌                                                                                                        |
| 45  | CMS content, YouTube videos, campaigns, city-wise seasons, tour packages                                                         | 🚫 mostly public-site concerns — out of PMS scope (confirm)                                               |
| 46  | **DMC management** (B2B bookings, invoicing, outstanding) + **Companies** (B2B agents)                                           | ❌ — this is the B2B/bedbank side; see §5                                                                 |
| 47  | Booking ops depth: check-in calendar, cancellation reasons, advance-payment emails (48/72h), resend SMS/email, CSV exports       | ❌                                                                                                        |

---

## 2. Category ① — Still missing from the legacy product (parity gaps)

Ranked by how much they block "a real hotel runs its day on this."

**P0 — blocks daily hotel operation**

1. **Dashboard / home screen** (rows 5): today's arrivals, departures, in-house guests, pending approvals, occupancy + revenue snapshot; group view for multi-property owners. This is the first screen a hotelier opens every morning — 2.0 has nothing.
2. **Check-in / check-out flow** (row 8) + booking **edit/amend** (row 9). Without these the booking lifecycle stops at "approved."
3. **Bank details + profile** (row 28): settlement is computed but there's no payee. Plus change-password and agreement acceptance.
4. **Real email/SMS sending** (row 29): wire a provider (e.g. Resend/SES + local SMS gateway); templates and message log already exist, so this is mostly plumbing.

**P1 — expected by owners, needed before cutover** 5. **Room/property photos & media** (row 19) — object storage + upload + display. 6. **Owner-facing ARI/price-change history** (row 15) — data already flows through outbox/audit; needs owner-scoped view. 7. **Min/max stay + restrictions** (row 18) — schema + calendar + booking validation. 8. **Reviews** (row 22). 9. **Onboarding/registration** (rows 2, 34): decide the model — staff-provisioned (legacy) vs self-serve signup with staff approval (better). 10. **Customer/CRM screen** (row 27). 11. **Excel bulk ARI upload** (row 16) — or consciously replace with the better calendar bulk-edit + (later) AI "set my August prices" — decide.

**P2 — parity long-tail** 12. Multi-currency display/USD (rows 23, 43); invoice PDF (row 24); connected-OTAs owner screen (row 20); CM-request flow (row 21); Sinhala/Tamil UI localization (row 4); help pages (row 31).

**Deliberately dropped (no action):** lock screen, flexi AM/PM inventory, email allow-list admin, cleartext backend bridge, fire-and-forget CM push — the last three are replaced by strictly better mechanisms.

---

## 3. Category ② — New things to add on (no legacy equivalent, but a real product needs them)

**Product**

- **Reports & analytics**: occupancy %, ADR, RevPAR, pace/pickup, channel mix, cancellation rate. Legacy had almost nothing (datametrix was crude) — this is a top competitor complaint (SiteMinder "wants deeper analytics"). Also the substrate the AI Revenue Manager will need anyway.
- **In-tenant user management**: invite OWNER_STAFF users, roles per property. Enum exists; no UI/API.
- **Direct booking engine / widget** (own-website bookings, zero commission) — wedge 4 "one platform," attacks Cloudbeds.
- **Payment gateway** (local: PayHere/Stripe) for deposits & direct bookings — legacy never had one; wedge 7 local payments.
- **Rate-parity monitoring** — legacy literally has a dormant `Parityrate` model; STAAH's RateSTalk shows the demand.
- **Mobile-first pass / PWA** — STAAH's #1 user complaint is mobile; our extranet must be excellent on a phone.
- **Guest messaging (two-way)** — beyond outbound log.

**Engineering (planned in the architecture, not yet built)**

- `packages/contracts` (tRPC/zod/OpenAPI), `packages/ui` (extract the inline design system), `packages/telemetry` (Sentry + OTel + Langfuse), `packages/testing` (parity harness).
- **API + e2e test coverage** (today: 0 tests in apps/api and web) and **CI pipeline** (GitHub Actions: typecheck, tests, build).
- **Hosting/deploy** (managed-first: Fly/Railway/Vercel/Neon/Upstash) + backups + monitoring. The product currently only runs on this PC.

---

## 4. Category ③ — Revamp features: AI & MCP (the differentiators)

Nothing AI exists in the repo yet (confirmed by sweep) — by design (MVP-first decision). The seams are ready: framework-free domain services, clean module boundaries, tenant-scoped everything. Build order within this category:

1. **`packages/mcp` — MCP tool surface over the domain/API services.** The foundation for every agent. Read-only, tenant-scoped tools first (availability, rates, bookings, finance), guardrails enforced in the tool layer, approval-gated writes later.
2. **Supplier Copilot (Phase 11, approved concept)** — the extranet chat: "how did last week do?", "open next month and price weekends at 30k", "why did this booking fail to sync?" First visible AI feature; read-only start.
3. **AI Revenue Manager** 🏆 wedge #1 — dynamic pricing proposals via the _existing_ approval workflow (rate suggestions land as approvals, owner one-taps). Needs the analytics substrate from §3 first. Phase 1 = Claude-reasoning + rules; Python ML later.
4. **AI Distribution Healer** — watches outbox/DLQ + OTA inbox failures, diagnoses, retries, drafts fixes; attacks "sync silently broke," pairs with wedge 3 reliability.
5. **AI Content & Localization** — property descriptions, photo captions, si/ta translations (directly solves the i18n parity gap cheaply).
6. **Agentic distribution** — MCP endpoint exposing _bookable inventory_ to external AI agents (conversational discovery, agent-bookable) — SiteMinder is already moving here; table stakes soon.
7. **Ops Copilot (staff) + anomaly/fraud watch** — later.
8. Supporting infra: Langfuse tracing (in telemetry package), pgvector when embeddings appear, model tiering (Opus/Sonnet/Haiku by task).

---

## 5. Category ④ — Other platform components

1. **Real channel-manager adapters** — the biggest external dependency. `CmAdapter` seam + outbox/retry/DLQ are done; `AxisRooms` and `RateGain` are NotImplemented stubs. Legacy AxisRooms integration (5 endpoints via core.yohobed.com, channel id 164) is the reference implementation to port. Blocked-ish on: API credentials/docs & a test property. **Decision needed: schedule the AxisRooms adapter, or ship MVP against the webhook/simulate path first?**
2. **ETL + cutover (Phase 10)** — migrate real MySQL (`armyoftheload`) → Postgres with the parity harness as the gate; unify TopDown pricing → per-day at ETL (locked decision); resolves the deferred BottomUp-vs-systemBaseRate inconsistency. Also the moment real data pressure-tests every screen.
3. **Staff console depth / `apps/web-staff`** — staff UI currently lives inside web-extranet at `/staff`. Fine for MVP; split + grow it when staff features (§1b) get scheduled.
4. **B2B distribution (DMC + Companies + open API)** — legacy's whole second business (DMC bookings, agent companies, outstanding invoicing). Wedge #6 says productize this into a marketplace + modern API. Big, separate compartment — post-cutover candidate.
5. **Public website / booking site (yohobed.com)** — legacy ecosystem component, out of current rebuild scope; the direct-booking engine (§3) partially covers it later.
6. **`apps/etl`** — doesn't exist yet; needed for #2.

---

## 6. Suggested next moves (for discussion)

The MVP-first decision says: finish a complete, usable PMS before AI. Reading the gaps against that, three coherent options:

**Option A — "A hotel can actually live here" (recommended)**
Close the P0 parity gaps as MVP Compartment G+H: Dashboard → check-in/out + booking edit → profile/bank details → real email/SMS → photos → ARI history → restrictions. Outcome: demoable to a real hotelier, cutover-ready product surface. ~the natural continuation of A–F.

**Option B — "Make it real" (integration track)**
AxisRooms adapter (port the legacy 5-endpoint contract onto the outbox) + ETL harness + hosting/CI. Outcome: real property, real data, real channel — the platform stops being a local demo. Best if CM credentials are obtainable now.

**Option C — "Show the magic" (AI track)**
packages/mcp + read-only Supplier Copilot on the existing domain services. Outcome: the differentiator demo for investors/hotels. Contradicts the MVP-first decision — only pick if there's an external reason (pitch, funding, sales demo).

**My recommendation:** A then B, interleaving B's hosting/CI early (cheap, de-risks everything), then C. Concretely: **Compartment G = Dashboard + check-in/out + booking edit** (turns the calendar app into a front-desk tool), **H = onboarding + profile/bank + email provider + photos**, then the AxisRooms adapter + ETL, then MCP/Copilot.

Open decisions to settle in this discussion:

1. Approve the P0/P1/P2 parity ranking (esp.: is Excel bulk upload kept or replaced?).
2. Onboarding model: staff-provisioned vs self-serve + approval.
3. AxisRooms: do we have (or can we get) API credentials/docs now?
4. B2B/DMC: park until post-cutover, or does the business need it sooner?
5. Multi-currency: LKR-only until cutover, or USD needed for current owners?
