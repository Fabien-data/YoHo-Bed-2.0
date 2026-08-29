-- Pre-deployment hardening (2026-08-28 audit).
--
-- 1. Night audit: the duplicate-run check in the service is a read-then-insert, so two concurrent
--    runs (a double-click on "Run") both pass it. The unique index is the real lock; the service
--    maps the 23505 to the same ConflictException the fast path raises.
CREATE UNIQUE INDEX IF NOT EXISTS "night_audit_runs_property_date_uq"
  ON "night_audit_runs" ("property_id", "from_date");
--> statement-breakpoint

-- 2. Folio: the room-night double-post guard is a partial unique index on
--    (folio_id, booking_date) WHERE source = 'room' — but booking_date is nullable, and unique
--    indexes treat NULLs as distinct. A room charge posted without its night would slip past the
--    guard forever, so make the pairing mandatory.
ALTER TABLE "folio_charges"
  ADD CONSTRAINT "folio_charges_room_needs_night_ck"
  CHECK ("source" <> 'room' OR "booking_date" IS NOT NULL);
--> statement-breakpoint

-- 3. Booking groups: nextGroupCode derives the code from count(*), which two concurrent
--    "Make group" calls can both read — without this, both silently get the same code.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_groups_property_code_uq"
  ON "booking_groups" ("property_id", "code");
--> statement-breakpoint

-- 4. Email delivery claim: concurrent deliverQueued passes both read the same queued rows and
--    double-send. 'sending' lets a deliverer claim rows atomically (queued -> sending) first.
ALTER TYPE "message_status" ADD VALUE IF NOT EXISTS 'sending' BEFORE 'sent';
