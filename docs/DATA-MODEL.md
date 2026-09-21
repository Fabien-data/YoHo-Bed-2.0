# YoHoBed 2.0 — Data Model

> Every table in `packages/db/src/schema/`, its purpose and key constraints, its row-level
> security status, the database helpers, the migration history, and what the dev seed creates.
>
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (why RLS is shaped this way) ·
> [PRICING.md](PRICING.md) (how the numeric columns are computed)

**RLS legend:** ✅ = `tenant_isolation` policy (`tenant_id = current_setting('app.tenant_id')`,
USING + WITH CHECK, applied by `src/rls.sql`). ➖ = deliberately none, with the reason. Global
lookup/identity tables have no `tenant_id` and no policy.

## Core relationship chains

```mermaid
erDiagram
  tenants ||--o{ users : "owns logins"
  users ||--o{ memberships : "role@tenant"
  tenants ||--o{ properties : ""
  properties ||--o{ rooms : ""
  rooms ||--o{ availability_calendar : "per date"
  rooms ||--o{ rate_plans : "x meal plan"
  rate_plans ||--o{ occupancies : "guest configs"
  occupancies ||--o{ rate_calendar : "price per date"
  properties ||--o{ property_tax_types : "taxes"
  properties ||--o{ commission_slabs : "if slab model"
```

```mermaid
erDiagram
  customers ||--o{ bookings : ""
  occupancies ||--o{ bookings : "pricing key"
  bookings ||--o{ booking_days : "per-night snapshot"
  bookings ||--o{ booking_approvals : "lifecycle trail"
  bookings ||--o| invoices : "INV-<ref>"
  invoices ||--o{ invoice_lines : ""
  bookings ||--o{ payments : ""
  bookings ||--o| reviews : "one per booking"
  bookings ||--o| review_invites : "single-use token"
  bookings ||--o| ota_reservations : "if OTA-sourced"
```

## Identity & tenancy (`schema/identity.ts`)

| Table             | RLS         | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`         | ➖ registry | A property owner — the root of every ownership chain. Unique `email`; `status` enum `pending/active/inactive/suspended`; `agreement_accepted_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `users`           | ➖ registry | Login identity. Unique `email`; nullable `tenant_id` (null = cross-tenant YoHo staff); bcrypt `password_hash`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `memberships`     | ➖ registry | What a user may do, where. Role enum `OWNER/OWNER_STAFF/YOHO_STAFF/YOHO_ADMIN`; staff rows have `tenant_id = null`; unique `(user_id, tenant_id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sessions`        | ➖ registry | Opaque token hashes (reserved for refresh flows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `password_resets` | ➖ registry | sha256 token hashes + 60-min expiry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `properties`      | ✅          | A property. `commission_type` `percentage`\|`slab` + `commission_percentage` (default 10) — how the Yoho commission is derived. Plus its identity & operating parameters: `code` (the number shown beside the name), address block (`address/city/state/country/zip`), `phone`, `email`, `timezone` (what night audit rolls the business date against), `checkin_time`/`checkout_time`, `star_rating`, `logo_media_id`. Regional identity (Phase 02): `country_code` (ISO alpha-2, default `LK`, CHECK shape, **locked once the property has bookings**), `state_code` (ISO for LK/MY, GST state code for IN), `legal_name`, `tax_ids` jsonb (`tin`, `ssclRegNo`, `sltdaRegNo`, `gstin`, `sstNo`, `ttxNo`, `brn`), `branch_code`, `fy_start_month` (1–12), `invoice_prefix`, and `settings` jsonb (reservation-desk settings, resolved by `resolvePropertySettings`). |

The Property Setup profile also stores `property_type`, `address_line_2`,
`reservation_phone`, `website`, `fax`, `registration_number`, four additional
registration numbers in `additional_registration_numbers`, and nullable
`latitude`/`longitude`. Coordinates must be present together and in range.
`logo_media_id` points to an existing photo owned by that property.

Identity tables are the tenancy _registry_ — they're what the guards consult to build the tenant
context, so they can't themselves sit behind it. Access is confined to auth/staff code paths.

`tenants.distribution_mode` (`yoho`\|`standalone`, default `yoho`) decides whether the platform
commission and payout chain apply at all. A `standalone` tenant bought the PMS as a subscription
and sells its own inventory. `RatesService.setPriceRange` gives it a zero commission
(`commissionStructureFor()`) and **no OTA gross-up**: its tax-exclusive price is the base price
exactly as entered. That base is not passed through `sellingPrice(base, 0, 0)`, whose round-up
step would add a cent to roughly one price in seventeen. (Before Phase 02 this was documented but
never wired, so standalone tenants were still grossed up.)

## Subscriptions & entitlements (`schema/billing.ts`)

| Table             | RLS          | Purpose · key constraints                                                                                                                                         |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plans`           | ➖ catalogue | The sellable tiers. Unique `code`; `price_monthly` + `currency`; `features` jsonb holding a `PlanFeatures` document; `status` `active`\|`archived`; `sort_order`. |
| `subscriptions`   | ✅           | One row per tenant (unique `tenant_id`) — the tier they are on. `status` `trialing/active/past_due/cancelled`; period dates; `seats`.                             |
| `tenant_features` | ✅           | Per-tenant override on top of the plan, so support can grant one module off-plan. Unique `(tenant_id, key)`; `enabled`; `limit_value` for the numeric caps.       |

`plans` is deliberately un-fenced: it is a global product catalogue, identical for every tenant and
safe to read. Only staff may write it, which `RolesGuard` enforces at the API.

Resolution lives in `resolveEntitlements()` in `@yohobed/domain` — plan grants first, tenant
overrides on top, **deny-by-default** so a newly added feature key is never accidentally live for
existing subscribers. A cancelled or past-due subscription grants nothing. The API and the web app
share that one function so they cannot disagree about what a tenant bought.

## Inventory (`schema/inventory.ts`)

| Table                   | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                       |
| ----------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roomtypes`             | ✅  | Per-tenant room category (Deluxe, Suite…).                                                                                                                                                                                                                                                      |
| `rooms`                 | ✅  | A sellable room type instance. `quantity` = physical count.                                                                                                                                                                                                                                     |
| `availability_calendar` | ✅  | **The single source of truth for sellable inventory.** Unique `(room_id, date)`; `physical_quantity`; `rooms_to_sell` with **`CHECK (rooms_to_sell >= 0)`** (the overbooking backstop); `status` Open/Close; `min_stay` (default 1) / `max_stay` (0 = unlimited) for arrival-date restrictions. |

### Buckets vs physical rooms

`rooms` is the **sellable bucket** — one row per room-type-per-property with a `quantity`. It is
what `availability_calendar`, `rate_plans`, `cm_room_mappings` and the outbox all speak, and none
of that changed when physical rooms arrived.

`room_units` sits beside it and answers what the bucket cannot: which actual room the guest is in.
That is the prerequisite for Stay View, Room View, room assignment and every housekeeping screen.

| Table                | RLS | Purpose · key constraints                                                                                                                                                    |
| -------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room_units`         | ✅  | A physically identifiable room. Unique `(property_id, code)` — codes are property-wide, not per room type. `display_order`, `floor`, `notes`, `status` `active`\|`inactive`. |
| `maintenance_blocks` | ✅  | A room out of service (the hatched bar on the tape chart). `block_from`/`block_to` half-open, `reason`, `released_at`. Overlapping live blocks on one room are refused.      |

`SUM(active room_units) = rooms.quantity` is deliberately **not** a constraint — a unit taken out
of service must be allowed to make the two diverge. `GET /properties/:id/room-units/counts`
surfaces the difference as a setup warning instead.

## Housekeeping (`schema/housekeeping.ts`)

| Table                 | RLS | Purpose · key constraints                                                                                                                                                    |
| --------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `housekeeping_status` | ✅  | One row per room per **day**. Unique `(room_unit_id, date)`; status `dirty`/`clean`/`inspected`/`out_of_order`; `assigned_to_user_id`, `remarks`, `changed_at`/`changed_by`. |
| `work_orders`         | ✅  | A maintenance job. Nullable `room_unit_id` — plenty of jobs are the lobby or the lift. `priority`, `status`, `assigned_to_user_id`, `deadline`, `completed_at`.              |

The enum is named `housekeeping_state`, not `housekeeping_status`: Postgres gives every table an
implicit composite type of the same name, so an enum cannot share its table's name.

**A missing row means `clean`** — a room nobody has touched is not dirty. Rows are created lazily,
so a 200-room hotel does not accrue 73,000 rows a year for rooms that were never occupied. Keying
by date rather than holding one "current status" column keeps history, which is what "who cleaned
05 on the 12th" needs, and what night audit will roll forward.

`out_of_order` here and a `maintenance_blocks` row are deliberately separate. A block reserves
**dates** — it is what stops the room being assigned next week. This is the state of the room
**today**. A supervisor marking a room out of order at 9am must not silently cancel next month's
reservations.

### Room state is derived, never stored

`Vacant / ArrivingToday / Occupied / PendingCheckout / OutOfOrder` is always a function of the
reservations plus the housekeeping flag. Storing it would create a second source of truth that
drifts the moment a booking is amended.

One subtlety worth knowing: a guest departing **today** is excluded by the half-open stay overlap
(`checkout` is exclusive) but is still physically in the room until they leave. That is exactly
`PendingCheckout`, so it needs its own query rather than falling out of the overlap — the same
reason Stay View's due-out count is computed separately from the bars it draws.

## Folio — the guest bill (`schema/folio.ts`)

| Table                | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `folios`             | ✅  | A billing window on a booking. Unique `(booking_id, window)`; `label`, `status` `open`/`closed`/`void`; currency inherited from the booking, never chosen. Phase 02 (0030): the payer — `payer_type` (CHECK guest/company/travel_agent), `payer_customer_id`, `payer_ledger_account_id` — and `routes text[]`, the charge sources this window takes instead of window 1. |
| `charge_particulars` | ✅  | The catalogue of chargeable items. Unique `(tenant_id, code)`; `default_price`, `tax_rate_pct`, `tax_inclusive`, `active`.                                                                                                                                                                                                                                               |
| `folio_charges`      | ✅  | One line on the bill. `net + tax = total`, always. `source` `room`/`manual`/`pos`/`inclusion`; `posted_for` is the business date; `voided_at` reverses without deleting. Phase 02 (0030): `tax_lines` jsonb, `booking_inclusion_id` — unique per night while live (`folio_charges_inclusion_night_uq`), so night audit never posts an inclusion twice.                   |
| `folio_transfers`    | ✅  | An audit row per charge moved between windows — the split-bill trail.                                                                                                                                                                                                                                                                                                    |

`payments` gains a nullable `folio_id`. Deliberately **not** a separate `folio_payments` table:
`payments` is already the record of what a guest paid, and a second one would be a second answer
to "is this settled?".

**Who pays, and routing (Development Phase 02, Sprint 5).** Room charges always post to window 1;
Bill To only decides window 1's payer. "Room & tax to the company, extras to the guest" is window 1
billed to the company plus window 2 billed to the guest with `routes = {manual,pos,inclusion}`:
anything posted by night audit or a completed transfer goes to the lowest open window whose
`routes` include its source, else window 1 (`folio/windows.ts`). At check-out a window billed to a
travel agent or company moves its balance to that account's ledger (Pro).

### Stay services (`schema/stay-services.ts`, migration 0030)

| Table                | RLS | Purpose · key constraints                                                                                                                                                                                                                                                           |
| -------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_inclusions` | ✅  | What a stay includes: `name`, optional `particular_id`, `rhythm` (CHECK: once, per_night, per_guest_per_night, per_adult_per_night, per_child_per_night), tax-inclusive `unit_price`, `discount_pct`, `tax_rate_pct`, `included_in_rate` (never posted — printing only), `itemize`. |
| `booking_transfers`  | ✅  | Pick-ups and drop-offs: `direction` (pickup/dropoff), `transport_mode_id`, `scheduled_at`, from/to, flight, pax, vehicle, driver, tax-inclusive `amount`, `status` (planned/done/cancelled) and `charge_id` — the folio line posted when it was done.                               |
| `transport_modes`    | ✅  | The vehicles: `code` unique per tenant, `name`, `default_price`, `sort`, `active`. Seeded per country by `ensureTransportModes` (on migrate, registration and in fixtures).                                                                                                         |

### Private files and document numbers (`schema/files.ts`, `schema/sequences.ts`, migration 0030)

| Table                | RLS | Purpose · key constraints                                                                                                                                                                                                                                                              |
| -------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private_files`      | ✅  | Payment slips and ID scans: random `storage_key` (unique), original name, MIME type, size, `purpose` (CHECK payment_slip/id_document/other). **No public policy** — unlike `media` — and the bytes live in `PRIVATE_FILES_DIR`, served only by `GET /files/:id` to a signed-in member. |
| `document_sequences` | ✅  | Gap-free numbers per property × `doc_type` × `period` (`UNIQUE(property_id, doc_type, period)`), taken with `INSERT … ON CONFLICT DO UPDATE … RETURNING` — never `count + 1`. Receipts (`RC<yy>-<nnnnn>`) now; tax invoices and credit notes in Sprint 6.                              |

### Room charges are copied, never recomputed

Posting room charges reads the `booking_days` snapshot and copies it. The money engine already
decided what each night costs; a second calculation is a second answer waiting to disagree with
settlement. **The snapshot is per room per night**, so each line is multiplied by
`bookings.rooms` — which is why the posted lines sum to `bookings.amount` exactly. That equality
is asserted in `folio.e2e.test.ts` and is the load-bearing guarantee of the folio.

Posting is idempotent through a partial unique index:

```sql
CREATE UNIQUE INDEX folio_charges_room_night_uq
  ON folio_charges (folio_id, booking_date)
  WHERE (source = 'room' AND voided_at IS NULL);
```

Excluding voided rows is what lets a wrongly-posted night be reversed and re-posted, while still
making a double-post impossible.

Extras follow the room rate's convention: a **tax-inclusive** price has its tax decomposed out of
the total, so a bill never mixes tax-in and tax-on lines. Voiding stamps `voided_at` rather than
deleting — a bill that silently loses a line is worse than one showing a line was reversed, and
the guest's copy may already be printed.

## Cashiering (`schema/cashiering.ts`)

| Table                  | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger_accounts`      | ✅  | Travel agents, companies and sales people in **one** table — they differ only in what they are called. Unique `(tenant_id, code)`; `credit_limit` (0 = no limit). Phase 02 adds invoicing and agent-terms depth: `legal_name`, `country_code`, `state_code`, `city`, `zip`, `mobile`, `registration_no`, `commission_plan` (CHECK) + `commission_value`, `discount_pct`, `default_market_segment_id`, `payment_terms_days`. |
| `ledger_account_rates` | ✅  | Contract rates (Phase 02, Pro): account × room type (× meal plan, optional) × `valid_from`–`valid_to`; `mode` fixed (tax-inclusive nightly rate) or `discount_pct`. The meal-plan row wins, then the latest.                                                                                                                                                                                                                |
| `ledger_entries`       | ✅  | The running account. `debit` increases what they owe us, `credit` is money received.                                                                                                                                                                                                                                                                                                                                        |
| `business_sources`     | ✅  | Where the business came from. Phase 02 adds `category` (`direct/ota/travel_agent/corporate` — Yanolja's Booking Source), `palette` (a `TAG_COLORS` key; the legacy hex `color` stays for old readers), `default_market_segment_id`, `commission_plan` + `commission_value`, `registration_no`, `collects_tourism_tax`, `sort`.                                                                                              |
| `cash_drawers`         | ✅  | A physical till. A property may run several.                                                                                                                                                                                                                                                                                                                                                                                |
| `drawer_sessions`      | ✅  | One cashier's shift. Partial unique index allows only **one open shift per drawer**.                                                                                                                                                                                                                                                                                                                                        |
| `expense_vouchers`     | ✅  | Money out of the till. Unique `(property_id, voucher_no)`.                                                                                                                                                                                                                                                                                                                                                                  |

`payments` gains `drawer_session_id` (which shift took it) and `ledger_account_id` (set when the
payment is a transfer to the city ledger rather than money arriving). `bookings` gains
`business_source_id` and `ledger_account_id`.

**Balances are never stored.** A stored balance and its entries are two answers to the same
question, and they drift the first time anything is back-dated.

**Only cash counts toward a drawer.** A card payment never entered the till, so including card
takings would make every shift look short by the day's card revenue. The variance is computed at
close and **frozen** on the row — recomputing it later would quietly rewrite history the moment a
back-dated payment landed on the shift.

`ledger_accounts` is not `referral_partners`: a referrer _earns_ commission from us, a ledger
account _owes_ us money.

## Reservation configuration (`schema/configuration.ts`, Development Phase 02)

| Table             | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                                         |
| ----------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `market_segments` | ✅  | Why the guest is staying. Unique `(tenant_id, code)`; `grp` CHECK `transient/group/contract/non_revenue`; `palette`; `excluded_from_sold` (complimentary and house use stay out of rooms sold); `sort`; `active`.                                                                                                 |
| `payment_methods` | ✅  | The Payment Mode list. Unique `(tenant_id, code)`; `category` CHECK `cash/card/bank_transfer/qr/wallet/cheque/city_ledger/online/other`; `requires_reference`; `is_default_cash` (one per tenant, enforced by the service); `is_guest_advance`; `currency` (foreign cash); `property_id` (null = all properties). |

**Vocabularies are CHECK-constrained text, not Postgres enums.** A value added to an enum cannot
be used in the same migration run (Drizzle applies every pending migration in one transaction),
and these lists are expected to grow.

**Seeded once per tenant.** `seedDefaultMasters` copies the country preset (`@yohobed/locale`)
into a tenant only if it has no market segments yet. It runs from `db:migrate` for existing
tenants, from registration, and from the e2e fixture. After that the lists belong to the owner:
entries are deactivated, never deleted, and re-running a migration never brings back an entry the
owner renamed. `applyRegionPreset` adds another country's missing codes on request.

## Night audit (`schema/nightaudit.ts`)

| Table              | RLS | Purpose · key constraints                                                                                  |
| ------------------ | --- | ---------------------------------------------------------------------------------------------------------- |
| `business_dates`   | ✅  | The property's business date. Unique per property — a chain across time zones legitimately differs.        |
| `night_audit_runs` | ✅  | One run: dates closed and rolled to, counts, totals, `summary` jsonb, and the user **and IP** that ran it. |

**The business date is not today's date.** A hotel's day ends when the night auditor says it does,
often at 3am, so a charge posted at 01:30 belongs to the previous business day. Every posting and
report keys off `business_dates` rather than `current_date` — that is the difference between a
report that reconciles and one that does not.

The run is one transaction: post the night's room charges, no-show what never arrived, force-close
any open till, roll the date. A half-run audit — charges posted but the date not moved — would
double-post on the next attempt.

**Nights already billed by hand are looked up and skipped, not caught.** Inserting and catching the
unique violation does not work: in Postgres an error aborts the whole transaction, so every later
statement fails even though the error was "handled". The totals are frozen in `summary` for the
same reason the drawer variance is.

## Rates & tax (`schema/rates.ts`, `schema/tax.ts`)

| Table                | RLS       | Purpose · key constraints                                                                                                                                             |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_codes`         | ➖ global | Meal-plan lookup: RO/BB/HB/FB/AI. No tenant id.                                                                                                                       |
| `rate_plans`         | ✅        | Room × meal plan. Status Active/Inactive. Phase 02: `audience` (all/local/foreign — a resident rate is sold only to a local guest) and a default `market_segment_id`. |
| `occupancies`        | ✅        | Guest configuration on a rate plan (label, accommodates) — **the pricing key every booking references** (legacy BUG #2 fix).                                          |
| `rate_calendar`      | ✅        | Price per occupancy per date. Unique `(occupancy_id, date)`; `base_price`, `commission`, `selling_price` (always engine-derived), `last_minute_drop_pct`.             |
| `commission_slabs`   | ✅        | Slab bands for slab-commission properties (`slab_start`–`slab_end` → flat `commission`).                                                                              |
| `seasons`            | ✅        | Named date range for bulk price authoring (API only; no UI yet).                                                                                                      |
| `tax_types`          | ✅        | A named tax (Service Charge, VAT…). Phase 02: `exemptible` — whether a tax-exempt guest is excused (false for a service charge).                                      |
| `tax_durations`      | ✅        | Time-bounded rate % for a tax type.                                                                                                                                   |
| `property_tax_types` | ✅        | Property ↔ tax link with **`CHECK (priority IN (1,2,3))`** — 1 = service charge, 2 = NBT, 3 = VAT (the legacy nesting order; see [PRICING.md](PRICING.md)).           |

## Bookings (`schema/bookings.ts`)

| Table               | RLS       | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`         | ✅        | A guest. Phase 02 adds a regional profile: `title`, `given_name`/`family_name` (optional — one full `name` is primary), `mobile_e164` (normalised, indexed with `lower(email)` for the duplicate check), `whatsapp`, `nationality_code`/`country_code` (ISO), `state`, `zip`, `gender`, `occupation`, `company_name`, `tax_id`, `consent_at`/`consent_version`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bookings`          | ✅        | The booking. Unique `reference` (`yymmdd####`); explicit `occupancy_id`; status enum `Pending/Approved/Rejected/Cancelled/NoShow/CheckedIn/CheckedOut`; source `Extranet/OTA/Backend`; money columns `amount`, `total_base_price`, `taxes`, `commissionable_amount` (= amount − taxes), `discount`; `checked_in_at`/`checked_out_at`; currency `LKR`. Phase 02: `reservation_kind` (CHECK: confirm, inquiry, online_failed, hold_confirm, hold_unconfirm — must agree with `status`), **`inventory_held` (generated: live and of a kind that takes rooms — never written)**, `inventory_released_from` (a no-show gave the later nights back), `hold_until`/`hold_reminded_at`, `origin` (direct/ota/travel_agent/corporate), `residency`, arrival/departure time, `market_segment_id`, `sales_person_id`, `business_source_id`/`ledger_account_id` (FKs from 0028), `voucher_no`, `created_by_user_id`, `sibling_index`, `pricing` (the terms it was sold on), `options` (Other Information), levy flags. |
| `booking_days`      | ✅        | **Per-night price snapshot at booking time** (base/selling/commission/tax) — the audit + settlement source, immune to later rate edits. `UNIQUE(booking_id, date)`. Phase 02: `list_selling_price` (the calendar's price), `rate_source` (calendar/override/contract/complimentary), `tax_lines` (the tax split per tax, adding up to `tax` exactly).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `booking_approvals` | ✅        | Lifecycle audit trail (created/approved/rejected/cancelled/no_show/checked_in/checked_out/amended, and from 0028 held/released/confirmed + reason + actor).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `booking_counters`  | ➖ global | Per-day counter behind `nextBookingReference` — references are globally unique like legacy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `booking_rooms`     | ✅        | **One leg per physical room** — what a tape-chart bar actually is. Nullable `room_unit_id` (unassigned), `leg_index` unique per booking, denormalised `checkin`/`checkout`, `adults`/`children`, `released_at`. Phase 02: `child_ages`, `extra_beds`, `preferred_room_unit_id` (an inquiry's requested room — a preference, not an assignment).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `booking_groups`    | ✅        | Sibling reservations under one Group ID (Yanolja's `3359-1` / `3359-2`). Purely presentational — it never merges the money. Phase 02: `kind` (`reservation` = created with a multi-room reservation and coded with its master reference; `manual` = Make Group), `owner_customer_id` (the paymaster), `bill_to`, `business_source_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

| `reservation_requests` | ✅ | Idempotency for `POST /reservations`: `(tenant_id, idempotency_key)` unique, a hash of the body and the first response. Pruned after two days. |

### Guests, documents and remarks (`schema/guests.ts`, migration 0029)

| Table             | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_guests`  | ✅  | Anyone sharing a room besides the guest it is booked for (`bookings.customer_id`). `UNIQUE(booking_id, customer_id)`. With the Guest List, each sibling booking already has its own `customer_id`; this table is for the second person in a room.                                                                                                                                                                                                                    |
| `guest_documents` | ✅  | ID documents checked at the desk: `type` (CHECK: nic, mykad, mypr, aadhaar, passport, driving_licence, voter_id, oci, other), `number`, issuing country, place and dates of issue and expiry, visa number/type/expiry, `verification` (original/copy/digital) with who and when, one `is_primary`. **CHECK: an Aadhaar number is exactly 4 digits** — UIDAI forbids keeping more, so no code path can. Scans go to the private file store (Sprint 5), never `media`. |
| `booking_remarks` | ✅  | Typed notes on a booking (CHECK: general, front_desk, housekeeping, accounts, kitchen, preference), non-blank, with author and time.                                                                                                                                                                                                                                                                                                                                 |

`work_orders` (housekeeping) gains `booking_id` (SET NULL), `department` (CHECK: housekeeping,
maintenance, front_desk, food_beverage, transport, other) and `trigger` (CHECK: instant, checkin,
checkout). A task that waits for check-in or check-out is due only once its booking reaches that
state — computed in the query, not stored. Only the API requires a booking for a waiting task: a
CHECK would make deleting the booking fail, because the link is SET NULL.

Every table with a `tenant_id` has RLS, except four documented in `rls.sql` (`audit_log`,
`cm_room_mappings`, `outbox`, `review_invites`); `packages/db/test/isolation.test.ts` fails if a
new table appears without a policy.

### Holding rooms: `inventory_held` (Development Phase 02)

Whether a booking has rooms out of `availability_calendar` is the single most important fact in
the system, so it is not stored — Postgres computes it:
`status NOT IN ('Cancelled','Rejected') AND reservation_kind NOT IN ('inquiry','online_failed')`.
Nothing can write it, and nothing can leave it disagreeing with the status. Every path that gives
rooms back or recounts them keys off it: reject, cancel, amend, the availability recount on
re-open, Stay View's sold count, room assignment. A no-show keeps holding the night it missed and
records `inventory_released_from` for the rest, which the recount honours.

`bookings_kind_matches_status` pins the two axes together: a Pending booking is an unconfirmed
kind; an Approved, arrived, departed or no-show booking is a confirmed one. The column defaults
(`status` Pending, `reservation_kind` hold_unconfirm) satisfy it, so an insert that states
neither is valid — but an import that states a status must state the kind too.

### Why legs, and why the money stays on the booking

A booking with `rooms = 3` gets three `booking_rooms` legs. Money remains entirely on `bookings`
and `booking_days`, so **`@yohobed/domain` is untouched** by physical rooms — a leg only records
where the guests sleep. Yanolja instead splits a multi-room booking into sibling reservations
under a Group ID; `booking_groups` reproduces that presentation without splitting the money.

**Double-booking a physical room is structurally impossible**, the same way `rooms_to_sell >= 0`
makes overselling a bucket impossible:

```sql
EXCLUDE USING gist (room_unit_id WITH =, daterange(checkin, checkout, '[)') WITH &&)
  WHERE (room_unit_id IS NOT NULL AND released_at IS NULL)
```

Three consequences worth knowing. Ranges are **half-open**, so a same-day turnover (one guest out,
the next in) is allowed rather than flagged as a clash. **Unassigned** legs hold no room, so any
number may coexist. And cancelling stamps `released_at` rather than nulling `room_unit_id` — the
room is freed for re-sale while "which room was that cancellation in?" stays answerable.
`NoShow` deliberately does **not** release: the room was held for a guest who never arrived.

## Commercial (`schema/commercial.ts`)

| Table                  | RLS | Purpose · key constraints                                                                                                          |
| ---------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `promotions`           | ✅  | Discount campaign per property (%, window, min nights). Applying writes the discount into `rate_calendar.last_minute_drop_pct`.    |
| `coupons`              | ✅  | Guest discount codes. Unique `(tenant_id, code)`; type percentage/fixed; window; `max_uses`/`used_count`; optional property scope. |
| `coupon_redemptions`   | ✅  | One row per redemption (booking, amount).                                                                                          |
| `referral_partners`    | ✅  | Partner + unique code + commission %.                                                                                              |
| `referral_commissions` | ✅  | Earned commission per booking (pending/paid).                                                                                      |

## Finance (`schema/finance.ts`)

| Table           | RLS | Purpose · key constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invoices`      | ✅  | An issued document. Number **unique per property** (0031; it was globally unique). `kind` legacy/tax_invoice/invoice/bill/proforma/credit_note, `profile` lk_vat/generic, the `folio_id` it bills, `original_invoice_id` + `credit_reason` for a credit note and `credited_at` on the invoice it cancels, `supplier`/`payer` snapshots, invoice and supply dates, `subtotal`/`tax_total`/`rounding`, `tax_summary`, `fx_rate`/`fx_quote` for a foreign-currency invoice, `fiscal_year`, `place_of_supply`. Every pre-Phase-02 row is `kind: 'legacy'`. |
| `invoice_lines` | ✅  | One line: description, quantity, unit price, `net`/`tax`/`tax_lines` (`net + tax = amount`), the `folio_charge_id` it came from, `posted_for`, and `hsn_sac` (India, Sprint 7).                                                                                                                                                                                                                                                                                                                                                                        |
| `payments`      | ✅  | Received/sent money against a booking (method, reference). `currency` is inherited from the booking, never chosen per payment — the settled-in-full check only totals payments sharing that denomination. Phase 02 (0030): the hotel's own method (`payment_method_id`, `method_code`; its category maps onto `method`), `taken_by_user_id`, `attachment_file_id` (a slip in `private_files`), `receipt_no` (shared by the rows of one split payment) and `allocation_group_id`.                                                                       |
| `payouts`       | ✅  | Snapshotted settlement for a property + period: gross/base/yoho/ota/taxes/netPayable; status pending/scheduled/paid; `currency` = the property's base currency (a settlement is never FX-converted).                                                                                                                                                                                                                                                                                                                                                   |

### Invoicing once, and correcting by credit note

A folio window is invoiced once: `invoices_folio_live_uq` is a partial unique index on
`(folio_id, kind)` where the document is live (`credited_at IS NULL`) and of a folio kind. An issued
document is never edited or voided — a credit note copies its lines, references it and stamps its
`credited_at`, which frees the window to be invoiced again. Numbers come from `document_sequences`
inside the issuing transaction, so a rollback gives the number back.

## The guest booking page (`schema/vouchers.ts`, migration 0031)

| Table            | RLS                      | Purpose · key constraints                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voucher_tokens` | ➖ **token IS the auth** | The link a guest opens with no login (portal-lite). A fresh random token, the booking it was made from, `expires_at` (30 days after check-out), `revoked_at`, and a view count. No RLS, like `review_invites`: the guest has no tenant context, so the token resolves the tenant and the page is then read under it. |

## Communications (`schema/comms.ts`)

| Table           | RLS       | Purpose · key constraints                                                                                                                                                         |
| --------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languages`     | ➖ global | Language lookup (en default, si, ta).                                                                                                                                             |
| `templates`     | ✅        | Per-tenant, per-language message templates with `{{placeholder}}` variables. Unique `(tenant_id, key, language)`. Every new tenant gets the starter set (`default-templates.ts`). |
| `notifications` | ✅        | In-app notifications (the bell): type, title, body, entity link, read flag.                                                                                                       |
| `messages`      | ✅        | The outbound email log: rendered subject/body, `status` queued/sent/failed + `error`. Queued in the business transaction; delivered post-commit by the mailer.                    |

## Distribution & OTA (`schema/distribution.ts`, `schema/ota.ts`)

| Table              | RLS                                          | Purpose · key constraints                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox`           | ➖ **worker drains all tenants**             | The transactional outbox (legacy BUG #3 fix): aggregate, event type, payload, status pending/processing/sent/failed, attempts/max (5), last error.                                                                        |
| `cm_room_mappings` | ➖ **webhook resolves tenant FROM the code** | Channel-manager room code → tenant/property/room. Unique `room_id`, unique `code`. Owner endpoints filter by tenant in the service layer.                                                                                 |
| `ota_reservations` | ✅                                           | Every reservation the channel manager ever pushed, and what became of it. Unique `(channel, external_ref)` (idempotency); status received/imported/failed/cancelled/ignored; raw payload jsonb; error text for the inbox. |

## Profile & media (`schema/profile.ts`)

| Table             | RLS                                 | Purpose · key constraints                                                                                                                                                                                              |
| ----------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payout_accounts` | ✅                                  | The settlement payee (bank/branch/holder/account/SWIFT). Unique per tenant.                                                                                                                                            |
| `media`           | ✅ writes, **public SELECT policy** | Uploaded photos. Unique random `storage_key` (never the user's filename); the extra `media_public_read` SELECT policy lets `GET /media/:key` serve bytes without a tenant context — the 128-bit key is the protection. |

## CRM & audit (`schema/crm.ts`, `schema/audit.ts`)

| Table            | RLS                      | Purpose · key constraints                                                                                                                               |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviews`        | ✅                       | One guest review per booking (unique `booking_id`), rating 1–5 + comment.                                                                               |
| `review_invites` | ➖ **token IS the auth** | Single-use public review route. PK = a fresh random token (not the booking id); `used_at` burns it. A guest has no tenant context — the row carries it. |
| `ari_history`    | ✅                       | Owner-facing log of every availability/price/drop/restriction change: kind, date range, detail jsonb, actor email.                                      |
| `audit_log`      | ➖ staff-only reads      | Append-only staff-action trail (actor, action, entity, detail). Read exclusively through the role-gated staff console.                                  |

## Database helpers (`packages/db/src/`)

| Helper                                                                                                | Purpose                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reserveBookingInventory / releaseBookingInventory` (`lifecycle.ts`)                                  | Take or give back one booking's rooms and tell the channel manager. A release from a date (a no-show) shortens the legs and records `inventory_released_from`.                               |
| `sweepReservationLifecycle(tx, tenantId, now)` (`lifecycle.ts`)                                       | Release due holds, remind before release, cancel unconfirmed bookings past arrival where the property asks. Claims rows with `FOR UPDATE SKIP LOCKED`; shared by the worker and night audit. |
| `dueLifecycleTenants(db, now)` (`lifecycle.ts`)                                                       | Calls the security-definer `lifecycle_due_tenants()` (in `rls.sql`): the tenant ids with lifecycle work due — the only thing the tenant-less worker may read.                                |
| `resolveTaxComponentsForDates(tx, propertyId, dates)` (`tax.ts`)                                      | Each tax behind the slot totals, with its name and `exemptible` flag — for splitting a night's tax into lines.                                                                               |
| `withTenant(db, tenantId, fn)` (`scope.ts`)                                                           | Opens a transaction, sets `app.tenant_id` LOCAL, runs `fn` under RLS. The only sanctioned way services touch tenant data.                                                                    |
| `setTenantContext(tx, tenantId)` (`scope.ts`)                                                         | Adopt a tenant context on an already-open transaction — for registration, which creates the tenant and its first fenced rows in one transaction. Satisfies RLS rather than bypassing it.     |
| `reserveStay(tx, roomId, nights, rooms)` (`inventory.ts`)                                             | Per-night atomic conditional decrement; throws `InsufficientAvailabilityError` (whole txn rolls back). The BUG #1 fix.                                                                       |
| `releaseStay(…)` (`inventory.ts`)                                                                     | Returns inventory, capped at `physical_quantity`.                                                                                                                                            |
| `nextBookingReference(tx, day)` (`bookings.ts`)                                                       | Race-free `yymmdd####` reference via an atomic upsert counter. The BUG #4 fix.                                                                                                               |
| `enqueueOutbox / claimPendingOutbox / markOutboxSent·Retry·Failed / requeueStaleOutbox` (`outbox.ts`) | The transactional-outbox machinery (claim uses `FOR UPDATE SKIP LOCKED`; stale `processing` rows are rescued after 120 s).                                                                   |
| `resolveTaxRatesForDates(tx, propertyId, dates)` (`tax.ts`)                                           | Per-date tax fractions `{serviceCharge, nbt, vat}` from the property's tax config (zeros when unconfigured).                                                                                 |
| `defaultTemplates / seedDefaultTemplates` (`default-templates.ts`)                                    | The starter message templates — single source used by **both** the dev seed and `/auth/register`.                                                                                            |
| `seedDefaultMasters / applyRegionPreset` (`masters.ts`)                                               | The reservation master lists from the country preset — seeded once per tenant (migration, registration, fixture); `applyRegionPreset` adds a preset's missing codes only.                    |
| `ensureTransportModes(tx, tenantId, country)` (`masters.ts`)                                          | Seed a tenant's transport modes if it has none — run on every migrate, so tenants created before Sprint 5 get them too.                                                                      |
| `nextDocumentNumber / nextReceiptNo` (`sequences.ts`)                                                 | The next gap-free number of a property's document series (an atomic upsert on `document_sequences`); `nextReceiptNo` formats `RC<yy>-<nnnnn>` for the business date's year.                  |
| `createDb(url, opts)` (`client.ts`)                                                                   | postgres.js + Drizzle handle; `migrate.ts` applies migrations then `rls.sql`.                                                                                                                |

## Migrations (`packages/db/drizzle/`, applied in order by `db:migrate`)

| #    | What it added                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000 | Identity & tenancy: tenants, users, memberships, sessions, password_resets, properties                                                                                                                                                                                                                         |
| 0001 | Inventory: rooms, availability_calendar (+ `rooms_to_sell >= 0` check)                                                                                                                                                                                                                                         |
| 0002 | roomtypes + rooms.roomtype_id                                                                                                                                                                                                                                                                                  |
| 0003 | Rates: rate_codes, rate_plans, occupancies, rate_calendar + property commission columns                                                                                                                                                                                                                        |
| 0004 | Bookings: customers, bookings, booking_days, booking_approvals, booking_counters                                                                                                                                                                                                                               |
| 0005 | outbox (transactional CM queue)                                                                                                                                                                                                                                                                                |
| 0006 | Finance: payments, invoices, invoice_lines, payouts                                                                                                                                                                                                                                                            |
| 0007 | audit_log                                                                                                                                                                                                                                                                                                      |
| 0008 | Tax parity: tax_types, tax_durations, property_tax_types, commission_slabs                                                                                                                                                                                                                                     |
| 0009 | Rates depth: seasons, last_minute_drop_pct                                                                                                                                                                                                                                                                     |
| 0010 | Commercial: promotions, coupons, coupon_redemptions, referral_partners, referral_commissions                                                                                                                                                                                                                   |
| 0011 | Comms: languages, templates, notifications, messages                                                                                                                                                                                                                                                           |
| 0012 | OTA inbox: cm_room_mappings, ota_reservations                                                                                                                                                                                                                                                                  |
| 0013 | Front desk: CheckedIn/CheckedOut statuses + checked_in_at/out_at (+ `amended` trail action)                                                                                                                                                                                                                    |
| 0014 | Onboarding: `pending` tenant status                                                                                                                                                                                                                                                                            |
| 0015 | Email seam: messages.error                                                                                                                                                                                                                                                                                     |
| 0016 | Compartment I: availability min_stay/max_stay, ari_history, reviews, review_invites                                                                                                                                                                                                                            |
| 0017 | Multi-currency: properties.currency, bookings.fx_rate_to_lkr, exchange_rates                                                                                                                                                                                                                                   |
| 0018 | Multi-currency: payments.currency, payouts.currency                                                                                                                                                                                                                                                            |
| 0019 | SaaS: plans, subscriptions, tenant_features, tenants.distribution_mode, property detail cols                                                                                                                                                                                                                   |
| 0020 | Room units: room_units, booking_rooms, booking_groups, maintenance_blocks + back-fill                                                                                                                                                                                                                          |
| 0021 | Housekeeping: housekeeping_status, work_orders + guest-depth columns on customers                                                                                                                                                                                                                              |
| 0022 | Data-only: grandfathers every existing tenant onto an enterprise subscription                                                                                                                                                                                                                                  |
| 0023 | Folio: folios, charge_particulars, folio_charges, folio_transfers, payments.folio_id                                                                                                                                                                                                                           |
| 0024 | Cashiering: ledger accounts/entries, business sources, drawers, expenses                                                                                                                                                                                                                                       |
| 0025 | Night audit: business_dates, night_audit_runs                                                                                                                                                                                                                                                                  |
| 0026 | Audit hardening: night-audit run index, room-line night check, group code index, `sending`                                                                                                                                                                                                                     |
| 0027 | Phase 02: market_segments, payment_methods, property regional identity + settings, source/account depth                                                                                                                                                                                                        |
| 0028 | Phase 02 reservation engine: booking kind + generated `inventory_held` + holds, guest profile, leg pax, group owner, day list price/rate source/tax lines, rate-plan audience, `ledger_account_rates`, `reservation_requests`, `tax_types.exemptible`, indexes; `held/released/confirmed` trail actions (last) |
| 0029 | Phase 02 guests & remarks: `booking_guests`, `guest_documents` (Aadhaar last-4 CHECK), `booking_remarks`; `work_orders` booking/department/trigger                                                                                                                                                             |
| 0031 | Phase 02 documents: invoice kind/profile/folio/credit-note/snapshot/total columns + number unique per property + one live document per window, invoice line detail, `voucher_tokens`; folio window-1 payer backfill                                                                                            |
| 0030 | Phase 02 money: `private_files`, `document_sequences`, `transport_modes`, `booking_inclusions`, `booking_transfers`; folio payer + routes; charge tax lines + inclusion link (unique per night); payment method/receipt/slip/allocation columns; `charge_source` gains `inclusion` (last)                      |

`db:migrate` finishes by (re)applying `rls.sql` — policies are idempotent (`DROP POLICY IF
EXISTS` + `CREATE`), so new tables added in a migration get fenced in the same run.

## The dev seed (`pnpm --filter @yohobed/db db:seed`)

Idempotent; runs as the table owner (bypasses RLS). Creates:

- **Logins** — owner `owner@demo.yohobed.test` / `password123` (tenant "Cinnamon Lakeside
  Group"); staff `staff@yohobed.test` / `password123` (cross-tenant `YOHO_STAFF`).
- **Property 1 — Cinnamon Lakeside** (percentage commission 10%, untaxed): room "Deluxe Room"
  ×5; 14 days of availability from 2026-08-01, with **2026-08-10 deliberately left at
  `rooms_to_sell = 1`** (the overbooking-race demo date); BB rate plan + "Double" occupancy;
  base Rs 18,000 weekday / 25,000 weekend priced through the engine.
- **Property 2 — Ceylon Tax Villa** (slab commission + 10% Service Charge + 15% VAT): room
  "Ocean Suite" ×3; slabs 0–20,000 → 2,500 and 20,000.01–100,000 → 4,000; a 15% last-minute drop
  on the first 3 nights; prints the reconciliation proof (see [PRICING.md](PRICING.md)).
- **Reference data** — rate codes RO/BB/HB/FB/AI; languages en/si/ta; the starter templates; CM
  room-code mappings `CM-DLX-001` (Deluxe) and `CM-OCN-101` (Ocean Suite).

> Note: the seed **resets the demo tenant's inventory** (delete-by-tenant) so it's deterministic —
> demo room/occupancy IDs change on every run. It never touches other tenants.
