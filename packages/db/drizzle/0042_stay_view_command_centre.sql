-- Stay View command centre. A block says what it is for, room and date changes made on the
-- calendar are recorded on the reservation's own trail, and every change to what the calendar
-- draws tells the open calendars about it.
ALTER TABLE "maintenance_blocks" ADD COLUMN "kind" text DEFAULT 'out_of_service' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_kind_valid" CHECK ("maintenance_blocks"."kind" in ('out_of_service', 'blocked'));--> statement-breakpoint
-- Live calendars: a change to a stay, a room assignment, a block, housekeeping, a room move or a
-- payment signals its property on channel `yhb_property`. Postgres delivers a notification only
-- when the transaction commits (a rolled-back change says nothing) and merges identical ones
-- within a transaction, so a bulk change is one signal per property, whoever made it — the API,
-- the worker or a channel import.
CREATE OR REPLACE FUNCTION yhb_notify_property() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data record;
  tenant uuid;
  property uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := OLD;
  ELSE
    row_data := NEW;
  END IF;
  IF TG_TABLE_NAME IN ('booking_rooms', 'payments') THEN
    SELECT b.tenant_id, b.property_id INTO tenant, property
      FROM bookings b WHERE b.id = row_data.booking_id;
  ELSE
    tenant := row_data.tenant_id;
    property := row_data.property_id;
  END IF;
  IF tenant IS NOT NULL AND property IS NOT NULL THEN
    PERFORM pg_notify('yhb_property', json_build_object('t', tenant, 'p', property)::text);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "bookings";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "bookings" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "booking_rooms";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "booking_rooms" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "maintenance_blocks";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "maintenance_blocks" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "housekeeping_status";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "housekeeping_status" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "room_moves";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "room_moves" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
DROP TRIGGER IF EXISTS "yhb_notify_property" ON "payments";--> statement-breakpoint
CREATE TRIGGER "yhb_notify_property" AFTER INSERT OR UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION yhb_notify_property();--> statement-breakpoint
-- Enum values last: Postgres 16 refuses a value added earlier in the same transaction, and a
-- fresh migrate runs every migration in one.
ALTER TYPE "public"."booking_action" ADD VALUE 'room_assigned';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'room_moved';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'stay_changed';
