CREATE TYPE "public"."room_unit_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_unit_id" uuid NOT NULL,
	"block_from" date NOT NULL,
	"block_to" date NOT NULL,
	"reason" text NOT NULL,
	"blocked_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"floor" text,
	"notes" text,
	"status" "room_unit_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_units_property_code_uq" UNIQUE("property_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"room_unit_id" uuid,
	"leg_index" integer DEFAULT 0 NOT NULL,
	"checkin" date NOT NULL,
	"checkout" date NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_rooms_booking_leg_uq" UNIQUE("booking_id","leg_index")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "group_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_room_unit_id_room_units_id_fk" FOREIGN KEY ("room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_units" ADD CONSTRAINT "room_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_units" ADD CONSTRAINT "room_units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_units" ADD CONSTRAINT "room_units_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_room_unit_id_room_units_id_fk" FOREIGN KEY ("room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_group_id_booking_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."booking_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Back-fill: expand each rooms.quantity bucket into physically numbered units.
--
-- Numbering runs across the WHOLE property, not per room type, so a property
-- reads 01..NN the way Yanolja's does. Ordering by created_at keeps it stable
-- and reproducible; a property with quantity 0 contributes nothing.
-- ---------------------------------------------------------------------------
INSERT INTO "room_units" ("tenant_id", "property_id", "room_id", "code", "display_order")
SELECT e.tenant_id, e.property_id, e.room_id, lpad(e.n::text, 2, '0'), e.n
FROM (
  SELECT r.tenant_id,
         r.property_id,
         r.id AS room_id,
         row_number() OVER (PARTITION BY r.property_id ORDER BY r.created_at, r.id, g.i) AS n
  FROM "rooms" r
  CROSS JOIN LATERAL generate_series(1, GREATEST(r.quantity, 0)) AS g(i)
) e
ON CONFLICT ON CONSTRAINT "room_units_property_code_uq" DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Back-fill: one leg per physical room on every booking that occupies inventory.
--
-- Rejected and Cancelled are excluded because they released their inventory.
-- NoShow is INCLUDED: the transition logic deliberately does not release it —
-- the room was held for a guest who never arrived, and the tape chart must show
-- that. Pax defaults from the occupancy the booking was priced on, which is a
-- better guess than 1 and is the only per-booking pax signal the old schema has.
-- ---------------------------------------------------------------------------
INSERT INTO "booking_rooms"
  ("tenant_id", "booking_id", "leg_index", "checkin", "checkout", "adults", "children")
SELECT b.tenant_id, b.id, g.i - 1, b.checkin, b.checkout,
       GREATEST(COALESCE(o.accommodates, 1), 1), 0
FROM "bookings" b
LEFT JOIN "occupancies" o ON o.id = b.occupancy_id
CROSS JOIN LATERAL generate_series(1, GREATEST(b.rooms, 1)) AS g(i)
-- Compared as text: on a fresh database every migration runs in one transaction, and Postgres
-- 16 refuses 'CheckedIn'/'CheckedOut' there because 0013 added them with ALTER TYPE.
WHERE b.status::text IN ('Pending', 'Approved', 'CheckedIn', 'CheckedOut', 'NoShow')
ON CONFLICT ON CONSTRAINT "booking_rooms_booking_leg_uq" DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Back-fill: greedy first-fit assignment of legs to units.
--
-- Earliest arrival first, lowest-numbered free unit wins — the same order a
-- front-desk agent would do it by hand. A leg that finds no free unit is left
-- UNASSIGNED rather than aborting: legacy data can be over-allocated (the bucket
-- model allowed selling more nights than there were physical rooms), and a
-- migration that refuses to run on real data is worthless.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leg RECORD;
  chosen uuid;
  unassigned int := 0;
BEGIN
  FOR leg IN
    SELECT br.id, br.checkin, br.checkout, b.room_id
    FROM "booking_rooms" br
    JOIN "bookings" b ON b.id = br.booking_id
    WHERE br.room_unit_id IS NULL AND br.released_at IS NULL
    ORDER BY br.checkin, br.id
  LOOP
    SELECT ru.id INTO chosen
    FROM "room_units" ru
    WHERE ru.room_id = leg.room_id
      AND ru.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM "booking_rooms" x
        WHERE x.room_unit_id = ru.id
          AND x.released_at IS NULL
          AND daterange(x.checkin, x.checkout, '[)')
              && daterange(leg.checkin, leg.checkout, '[)')
      )
    ORDER BY ru.display_order, ru.code
    LIMIT 1;

    IF chosen IS NULL THEN
      unassigned := unassigned + 1;
    ELSE
      UPDATE "booking_rooms" SET room_unit_id = chosen WHERE id = leg.id;
    END IF;
  END LOOP;

  IF unassigned > 0 THEN
    RAISE NOTICE 'room-unit back-fill: % leg(s) left unassigned (over-allocated legacy data)',
      unassigned;
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Make double-booking a physical room impossible, the same way rooms_to_sell >= 0
-- makes overselling a bucket impossible. Half-open ranges, so a same-day
-- checkout/checkin pair does NOT collide. Released legs (cancelled/rejected) and
-- unassigned legs are excluded from the constraint.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_no_double_booking"
  EXCLUDE USING gist (
    "room_unit_id" WITH =,
    daterange("checkin", "checkout", '[)') WITH &&
  ) WHERE ("room_unit_id" IS NOT NULL AND "released_at" IS NULL);--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_no_overlap"
  EXCLUDE USING gist (
    "room_unit_id" WITH =,
    daterange("block_from", "block_to", '[)') WITH &&
  ) WHERE ("released_at" IS NULL);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_rooms_unit_dates_idx"
  ON "booking_rooms" ("room_unit_id", "checkin", "checkout");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_rooms_booking_idx" ON "booking_rooms" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_units_property_order_idx"
  ON "room_units" ("property_id", "display_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_blocks_unit_dates_idx"
  ON "maintenance_blocks" ("room_unit_id", "block_from", "block_to");
