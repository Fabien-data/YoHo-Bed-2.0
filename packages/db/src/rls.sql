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

ALTER TABLE availability_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON availability_calendar;
CREATE POLICY tenant_isolation ON availability_calendar
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
