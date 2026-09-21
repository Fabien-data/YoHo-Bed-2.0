ALTER TYPE "public"."booking_action" ADD VALUE 'voided';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"leg_id" uuid NOT NULL,
	"from_room_unit_id" uuid NOT NULL,
	"to_room_unit_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "room_moves_status_valid" CHECK ("room_moves"."status" in ('planned', 'completed', 'stopped'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_from_room_unit_id_room_units_id_fk" FOREIGN KEY ("from_room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_to_room_unit_id_room_units_id_fk" FOREIGN KEY ("to_room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_moves" ADD CONSTRAINT "room_moves_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
