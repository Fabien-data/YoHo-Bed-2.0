-- ---------------------------------------------------------------------------
-- Give every existing tenant a subscription.
--
-- Entitlements are deny-by-default, so a tenant with no `subscriptions` row is
-- entitled to NOTHING. That was harmless while nothing was gated, and stops
-- being harmless the moment a module carries @Feature() — which Sprint 4's work
-- orders do.
--
-- Existing tenants predate the plan layer and have been using the platform
-- without restriction, so they are grandfathered onto `enterprise` rather than
-- silently downgraded. New sign-ups start on a Starter trial (see
-- AuthService.register).
--
-- Idempotent: `subscriptions.tenant_id` is unique, and this only inserts for
-- tenants that have no row at all.
-- ---------------------------------------------------------------------------
INSERT INTO "subscriptions" ("tenant_id", "plan_id", "status")
SELECT t.id, p.id, 'active'
FROM "tenants" t
CROSS JOIN (SELECT id FROM "plans" WHERE code = 'enterprise' LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s.tenant_id = t.id)
ON CONFLICT DO NOTHING;
