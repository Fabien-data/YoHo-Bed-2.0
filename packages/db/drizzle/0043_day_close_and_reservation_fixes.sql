-- Property set-up fixes (owner brief, 2026-09-26).
--
-- 1. An online booking that failed now holds its rooms. The guest booked through a website and
--    believes they have a room, so the hotel keeps one for them until the desk confirms or
--    cancels it. Only an inquiry holds nothing. Postgres 16 cannot change a generated column's
--    expression in place, so the column is dropped and added again; nothing indexes it.
ALTER TABLE "bookings" drop column "inventory_held";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "inventory_held" boolean GENERATED ALWAYS AS (status not in ('Cancelled', 'Rejected') and reservation_kind <> 'inquiry') STORED NOT NULL;--> statement-breakpoint
-- The column above has just turned true for the live online-failed bookings, so their nights
-- come out of the live counters to match (what a recount would now give). A night already sold to
-- someone else stays at 0 — rooms_to_sell may never go negative — and the stay waits in Stay
-- View's unassigned lane for the desk to place.
UPDATE "availability_calendar" ac
   SET rooms_to_sell = GREATEST(ac.rooms_to_sell - taken.rooms, 0), updated_at = now()
  FROM (
    SELECT b.room_id, d::date AS date, SUM(b.rooms)::int AS rooms
      FROM "bookings" b
     CROSS JOIN LATERAL generate_series(
            b.checkin::timestamp,
            (COALESCE(b.inventory_released_from, b.checkout) - 1)::timestamp,
            interval '1 day') AS d
     WHERE b.reservation_kind = 'online_failed'
       AND b.inventory_held
     GROUP BY b.room_id, d::date
  ) taken
 WHERE ac.room_id = taken.room_id
   AND ac.date = taken.date;--> statement-breakpoint
-- 2. A VIP stay: a flag the desk puts on the reservation, shown with a crown everywhere.
ALTER TABLE "bookings" ADD COLUMN "is_vip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- 3. The day closes by itself: an automatic night audit has no user, so the log records how it ran.
ALTER TABLE "night_audit_runs" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "night_audit_runs" ADD CONSTRAINT "night_audit_runs_trigger_valid" CHECK ("night_audit_runs"."trigger" in ('manual', 'auto'));--> statement-breakpoint
-- A business date that moves (an audit run by hand or by itself) tells the open calendars too, so
-- "Night audit last closed …" and the day's counts change without anyone reloading.
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "business_dates";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE ON "business_dates" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();
