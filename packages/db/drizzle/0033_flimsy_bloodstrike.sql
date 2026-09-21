ALTER TYPE "public"."role_key" ADD VALUE 'HOUSEKEEPING_ATTENDANT' BEFORE 'YOHO_STAFF';--> statement-breakpoint
ALTER TYPE "public"."role_key" ADD VALUE 'HOUSEKEEPING_SUPERVISOR' BEFORE 'YOHO_STAFF';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floor_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"floor" text NOT NULL,
	"landmarks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_layouts_property_floor_uq" UNIQUE("property_id","floor")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "housekeeping_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_unit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rush" boolean DEFAULT false NOT NULL,
	"assigned_to_user_id" uuid,
	"booking_id" uuid,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "housekeeping_tasks_room_date_kind_uq" UNIQUE("room_unit_id","date","kind"),
	CONSTRAINT "housekeeping_tasks_kind_valid" CHECK ("housekeeping_tasks"."kind" in ('departure', 'stayover', 'arrival_prep')),
	CONSTRAINT "housekeeping_tasks_status_valid" CHECK ("housekeeping_tasks"."status" in ('queued', 'in_progress', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_stay_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"do_not_disturb" boolean DEFAULT false NOT NULL,
	"requested_safety_flag" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_stay_signals_booking_uq" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "smoking_policy" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "wheelchair_accessible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "connected_room_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "map_x" integer;--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "map_y" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "floor_layouts" ADD CONSTRAINT "floor_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "floor_layouts" ADD CONSTRAINT "floor_layouts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_room_unit_id_room_units_id_fk" FOREIGN KEY ("room_unit_id") REFERENCES "public"."room_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_stay_signals" ADD CONSTRAINT "room_stay_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_stay_signals" ADD CONSTRAINT "room_stay_signals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_stay_signals" ADD CONSTRAINT "room_stay_signals_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "housekeeping_tasks_property_date_idx" ON "housekeeping_tasks" USING btree ("property_id","date");