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
