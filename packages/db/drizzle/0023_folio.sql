CREATE TYPE "public"."charge_category" AS ENUM('room', 'food', 'beverage', 'service', 'misc');--> statement-breakpoint
CREATE TYPE "public"."charge_source" AS ENUM('room', 'manual', 'pos');--> statement-breakpoint
CREATE TYPE "public"."folio_status" AS ENUM('open', 'closed', 'void');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "charge_particulars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" charge_category DEFAULT 'misc' NOT NULL,
	"default_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"tax_inclusive" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_particulars_tenant_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folio_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"folio_id" uuid NOT NULL,
	"particular_id" uuid,
	"source" charge_source DEFAULT 'manual' NOT NULL,
	"description" text NOT NULL,
	"posted_for" date NOT NULL,
	"booking_date" date,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"posted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folio_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"from_folio_id" uuid NOT NULL,
	"to_folio_id" uuid NOT NULL,
	"reason" text,
	"moved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"window" integer DEFAULT 1 NOT NULL,
	"label" text DEFAULT 'Guest' NOT NULL,
	"status" "folio_status" DEFAULT 'open' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folios_booking_window_uq" UNIQUE("booking_id","window")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "folio_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "charge_particulars" ADD CONSTRAINT "charge_particulars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "charge_particulars" ADD CONSTRAINT "charge_particulars_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_particular_id_charge_particulars_id_fk" FOREIGN KEY ("particular_id") REFERENCES "public"."charge_particulars"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_transfers" ADD CONSTRAINT "folio_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_transfers" ADD CONSTRAINT "folio_transfers_charge_id_folio_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."folio_charges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_transfers" ADD CONSTRAINT "folio_transfers_from_folio_id_folios_id_fk" FOREIGN KEY ("from_folio_id") REFERENCES "public"."folios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_transfers" ADD CONSTRAINT "folio_transfers_to_folio_id_folios_id_fk" FOREIGN KEY ("to_folio_id") REFERENCES "public"."folios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_transfers" ADD CONSTRAINT "folio_transfers_moved_by_user_id_users_id_fk" FOREIGN KEY ("moved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_charges_folio_idx" ON "folio_charges" USING btree ("folio_id","posted_for");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Posting the room charges twice would silently double a guest's bill, so the database refuses
-- it: at most one live room charge per folio per night. Voided lines are excluded, which is what
-- lets a wrongly-posted night be reversed and re-posted.
CREATE UNIQUE INDEX IF NOT EXISTS "folio_charges_room_night_uq"
  ON "folio_charges" ("folio_id", "booking_date")
  WHERE ("source" = 'room' AND "voided_at" IS NULL);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_folio_idx" ON "payments" ("folio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_booking_idx" ON "folios" ("booking_id");
