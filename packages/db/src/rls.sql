-- Row-Level Security: defense-in-depth tenant isolation.
-- Applied after the Drizzle migrations by src/migrate.ts.
--
-- The application connects as the restricted role `yoho_app` (below), which RLS applies to.
-- Migrations/seeds run as the table owner (postgres), which bypasses RLS — so seeding is
-- unconstrained while the running app is always fenced to its tenant.

-- 1. Restricted application role (RLS applies to it: not superuser, not table owner).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yoho_app') THEN
    CREATE ROLE yoho_app LOGIN PASSWORD 'yoho_app_pw';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO yoho_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yoho_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yoho_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yoho_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO yoho_app;

-- 2. Tenant isolation policy on tenant-owned tables.
--    `current_setting('app.tenant_id', true)` returns NULL when unset (missing_ok=true),
--    and nullif(...,'') guards the empty-string case — so an unset context sees NOTHING.
ALTER TABLE floor_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON room_moves;
CREATE POLICY tenant_isolation ON room_moves
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON floor_layouts;
CREATE POLICY tenant_isolation ON floor_layouts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE room_stay_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON room_stay_signals;
CREATE POLICY tenant_isolation ON room_stay_signals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE housekeeping_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON housekeeping_tasks;
CREATE POLICY tenant_isolation ON housekeeping_tasks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON properties;
CREATE POLICY tenant_isolation ON properties
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rooms;
CREATE POLICY tenant_isolation ON rooms
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE roomtypes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roomtypes;
CREATE POLICY tenant_isolation ON roomtypes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE rate_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rate_plans;
CREATE POLICY tenant_isolation ON rate_plans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE occupancies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON occupancies;
CREATE POLICY tenant_isolation ON occupancies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE rate_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rate_calendar;
CREATE POLICY tenant_isolation ON rate_calendar
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bookings;
CREATE POLICY tenant_isolation ON bookings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_days;
CREATE POLICY tenant_isolation ON booking_days
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_approvals;
CREATE POLICY tenant_isolation ON booking_approvals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments;
CREATE POLICY tenant_isolation ON payments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_lines;
CREATE POLICY tenant_isolation ON invoice_lines
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payouts;
CREATE POLICY tenant_isolation ON payouts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE availability_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON availability_calendar;
CREATE POLICY tenant_isolation ON availability_calendar
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commission_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON commission_slabs;
CREATE POLICY tenant_isolation ON commission_slabs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tax_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tax_types;
CREATE POLICY tenant_isolation ON tax_types
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tax_durations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tax_durations;
CREATE POLICY tenant_isolation ON tax_durations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE property_tax_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON property_tax_types;
CREATE POLICY tenant_isolation ON property_tax_types
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON seasons;
CREATE POLICY tenant_isolation ON seasons
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON promotions;
CREATE POLICY tenant_isolation ON promotions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON coupons;
CREATE POLICY tenant_isolation ON coupons
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON coupon_redemptions;
CREATE POLICY tenant_isolation ON coupon_redemptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE referral_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON referral_partners;
CREATE POLICY tenant_isolation ON referral_partners
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE referral_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON referral_commissions;
CREATE POLICY tenant_isolation ON referral_commissions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON templates;
CREATE POLICY tenant_isolation ON templates
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ota_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ota_reservations;
CREATE POLICY tenant_isolation ON ota_reservations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- cm_room_mappings deliberately has NO RLS (like outbox): the webhook resolves the tenant FROM
-- the room code before any tenant context exists. Owner endpoints filter by tenant in the service.

ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payout_accounts;
CREATE POLICY tenant_isolation ON payout_accounts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON media;
CREATE POLICY tenant_isolation ON media
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- media: writes stay tenant-fenced, but SELECT is open — the public photo route serves bytes by
-- an unguessable 128-bit random key with no tenant context (browser <img> can't send JWTs).
DROP POLICY IF EXISTS media_public_read ON media;
CREATE POLICY media_public_read ON media FOR SELECT USING (true);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reviews;
CREATE POLICY tenant_isolation ON reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- review_invites deliberately has NO RLS (like cm_room_mappings): a guest submitting a review
-- has no tenant context; the unguessable 128-bit token IS the authorization and resolves the
-- tenant. The service only ever reads by exact token.
--
-- voucher_tokens (Development Phase 02, Sprint 6) likewise has NO RLS, for the same reason: the
-- guest booking page is opened by a guest with no tenant context. The public route reads it by
-- exact token only; everything the page shows is then read under the token's tenant.
--
-- ux_events and ux_survey_responses (UX Excellence Program, UX-0) have NO RLS, like audit_log:
-- every tenant's staff write their own rows, and only the role-gated staff console reads them,
-- always filtering by tenant explicitly. They hold no guest data by design — a row names a task,
-- never a booking, guest, room or amount. system_heartbeats has no tenant at all.

ALTER TABLE ari_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ari_history;
CREATE POLICY tenant_isolation ON ari_history
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Subscriptions & entitlements (Yanolja-parity Sprint 0).
-- `plans` deliberately has NO RLS: it is a global product catalogue, identical for every tenant
-- and safe to read. Only staff may write it, which is enforced by RolesGuard in the API.

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_features;
CREATE POLICY tenant_isolation ON tenant_features
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Room units, booking legs, groups and maintenance blocks (Yanolja-parity Sprint 2).

ALTER TABLE room_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON room_units;
CREATE POLICY tenant_isolation ON room_units
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_rooms;
CREATE POLICY tenant_isolation ON booking_rooms
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_groups;
CREATE POLICY tenant_isolation ON booking_groups
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE maintenance_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maintenance_blocks;
CREATE POLICY tenant_isolation ON maintenance_blocks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Housekeeping and work orders (Yanolja-parity Sprint 4).

ALTER TABLE housekeeping_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON housekeeping_status;
CREATE POLICY tenant_isolation ON housekeeping_status
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON work_orders;
CREATE POLICY tenant_isolation ON work_orders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Folio, charges and transfers (Yanolja-parity Sprint 5).

ALTER TABLE folios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON folios;
CREATE POLICY tenant_isolation ON folios
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE charge_particulars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON charge_particulars;
CREATE POLICY tenant_isolation ON charge_particulars
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE folio_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON folio_charges;
CREATE POLICY tenant_isolation ON folio_charges
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE folio_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON folio_transfers;
CREATE POLICY tenant_isolation ON folio_transfers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Cashiering: ledgers, business sources, drawers, expenses (Yanolja-parity Sprint 6).

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_accounts;
CREATE POLICY tenant_isolation ON ledger_accounts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_entries;
CREATE POLICY tenant_isolation ON ledger_entries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE business_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_sources;
CREATE POLICY tenant_isolation ON business_sources
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE cash_drawers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_drawers;
CREATE POLICY tenant_isolation ON cash_drawers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE drawer_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON drawer_sessions;
CREATE POLICY tenant_isolation ON drawer_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE expense_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expense_vouchers;
CREATE POLICY tenant_isolation ON expense_vouchers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Reservation master lists (Development Phase 02, Sprint 1).

ALTER TABLE market_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON market_segments;
CREATE POLICY tenant_isolation ON market_segments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_methods;
CREATE POLICY tenant_isolation ON payment_methods
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The reservation engine (Development Phase 02, Sprint 2).

ALTER TABLE reservation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reservation_requests;
CREATE POLICY tenant_isolation ON reservation_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ledger_account_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_account_rates;
CREATE POLICY tenant_isolation ON ledger_account_rates
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The full reservation page (Development Phase 02, Sprint 4).

ALTER TABLE booking_guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_guests;
CREATE POLICY tenant_isolation ON booking_guests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE guest_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON guest_documents;
CREATE POLICY tenant_isolation ON guest_documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_remarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_remarks;
CREATE POLICY tenant_isolation ON booking_remarks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Money at reservation and stay services (Development Phase 02, Sprint 5). private_files in
-- particular must never be readable across tenants: it holds payment slips and passport scans.

ALTER TABLE private_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON private_files;
CREATE POLICY tenant_isolation ON private_files
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_sequences;
CREATE POLICY tenant_isolation ON document_sequences
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE transport_modes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_modes;
CREATE POLICY tenant_isolation ON transport_modes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_inclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_inclusions;
CREATE POLICY tenant_isolation ON booking_inclusions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_transfers;
CREATE POLICY tenant_isolation ON booking_transfers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Which tenants have reservation-lifecycle work due: a hold past its release time, a hold inside
-- its reminder window, or an unconfirmed booking past its arrival day at a property that releases
-- those. The worker runs without a tenant context, so under RLS it can see no bookings at all;
-- this function is the one narrow window it gets, and it returns tenant ids only. Everything the
-- sweep then reads or writes happens inside that tenant's own RLS-scoped transaction.
--
-- A property's timezone is text an owner once typed; a bad one must not stop every tenant's
-- sweep, so it falls back to UTC.
CREATE OR REPLACE FUNCTION yhb_local_date(at timestamptz, tz text) RETURNS date
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN (at AT TIME ZONE tz)::date;
EXCEPTION WHEN others THEN
  RETURN (at AT TIME ZONE 'UTC')::date;
END
$$;

CREATE OR REPLACE FUNCTION yhb_local_hour(at timestamptz, tz text) RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN extract(hour from at AT TIME ZONE tz)::integer;
EXCEPTION WHEN others THEN
  RETURN extract(hour from at AT TIME ZONE 'UTC')::integer;
END
$$;

CREATE OR REPLACE FUNCTION housekeeping_due_properties(at timestamptz)
RETURNS TABLE("tenantId" uuid, "propertyId" uuid, "localDate" date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.tenant_id, p.id, yhb_local_date(at, p.timezone)
    FROM properties p
   WHERE yhb_local_hour(at, p.timezone) >= 2
$$;

-- The reminder window in hours, as resolvePropertySettings reads it: default 6, 0 = off.
CREATE OR REPLACE FUNCTION yhb_hold_reminder_hours(settings jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(settings #> '{hold,reminderHours}') = 'number'
      THEN least(greatest((settings #>> '{hold,reminderHours}')::numeric, 0), 720)
    ELSE 6
  END
$$;

CREATE OR REPLACE FUNCTION lifecycle_due_tenants(at timestamptz) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.tenant_id
    FROM bookings b
   WHERE b.hold_until IS NOT NULL
     AND b.hold_until <= at
     AND b.status IN ('Pending', 'Approved')
  UNION
  SELECT b.tenant_id
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
   WHERE b.hold_until IS NOT NULL
     AND b.hold_until > at
     AND b.hold_reminded_at IS NULL
     AND b.status IN ('Pending', 'Approved')
     AND yhb_hold_reminder_hours(p.settings) > 0
     AND b.hold_until - make_interval(secs => yhb_hold_reminder_hours(p.settings) * 3600) <= at
  UNION
  SELECT b.tenant_id
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
   WHERE b.status = 'Pending'
     AND p.settings ->> 'unconfirmedPolicy' = 'arrival_day_end'
     AND b.checkin < yhb_local_date(at, p.timezone)
$$;
REVOKE ALL ON FUNCTION lifecycle_due_tenants(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifecycle_due_tenants(timestamptz) TO yoho_app;

-- Business date + night audit log (Yanolja-parity Sprint 7).

ALTER TABLE business_dates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_dates;
CREATE POLICY tenant_isolation ON business_dates
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE night_audit_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON night_audit_runs;
CREATE POLICY tenant_isolation ON night_audit_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Identity tables (2026-08-28 audit).
--
-- These cannot take the plain tenant_isolation policy: login and registration resolve users
-- BEFORE any tenant context exists, staff rows carry tenant_id = NULL, and sessions /
-- password_resets have no tenant column at all. The shape used instead: an UNSCOPED connection
-- (no app.tenant_id set — the auth flows, which run on the service handle by design) sees
-- everything, while a tenant-scoped transaction is fenced to its own tenant. Without this, the
-- identity tables were the one place a forgotten WHERE clause could leak every tenant's emails,
-- password hashes and live session-token hashes instead of returning nothing.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_scope ON users;
CREATE POLICY identity_scope ON users
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    -- Staff users stay readable in tenant context so audit-log joins can name who acted.
    OR tenant_id IS NULL
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_scope ON memberships;
CREATE POLICY identity_scope ON memberships
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_scope ON tenants;
CREATE POLICY identity_scope ON tenants
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

-- Token stores: no tenant column, and no tenant-scoped code path has any business reading them.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_scope ON sessions;
CREATE POLICY identity_scope ON sessions
  USING (nullif(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NULL);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_scope ON password_resets;
CREATE POLICY identity_scope ON password_resets
  USING (nullif(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NULL);
