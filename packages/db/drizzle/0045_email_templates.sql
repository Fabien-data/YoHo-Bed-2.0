-- Configuration → Email templates (owner brief, 2026-09-26): a hotel can add its own check-out
-- emails, named in its own words, and pick one per reservation. The starter templates keep a null
-- name (the catalogue in @yohobed/domain names them). Upgrading the untouched starter confirmation
-- ("Total: Rs {{amount}}", wrong for a USD hotel) runs in migrate.ts, per tenant.
ALTER TABLE "templates" ADD COLUMN "name" text;