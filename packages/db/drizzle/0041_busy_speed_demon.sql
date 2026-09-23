CREATE TABLE IF NOT EXISTS "property_levies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"basis" text DEFAULT 'per_room_per_night' NOT NULL,
	"applies_to" text DEFAULT 'non_resident' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"registration_no" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_levies_property_code_uq" UNIQUE("property_id","code"),
	CONSTRAINT "property_levies_basis_valid" CHECK ("property_levies"."basis" in ('per_room_per_night')),
	CONSTRAINT "property_levies_applies_valid" CHECK ("property_levies"."applies_to" in ('non_resident', 'all')),
	CONSTRAINT "property_levies_amount_valid" CHECK ("property_levies"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"arrived_from" text,
	"arrived_in_country_on" date,
	"port_of_entry" text,
	"next_destination" text,
	"purpose_of_visit" text,
	"form_c_status" text DEFAULT 'not_required' NOT NULL,
	"form_c_reference" text,
	"form_c_submitted_at" timestamp with time zone,
	"form_c_submitted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stay_registrations_booking_uq" UNIQUE("booking_id"),
	CONSTRAINT "stay_registrations_form_c_status_valid" CHECK ("stay_registrations"."form_c_status" in ('not_required', 'pending', 'submitted')),
	CONSTRAINT "stay_registrations_form_c_submitted" CHECK ("stay_registrations"."form_c_status" <> 'submitted' or ("stay_registrations"."form_c_reference" is not null and "stay_registrations"."form_c_submitted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_profile_valid";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "tax_mode" text DEFAULT 'inclusive_legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_calendar" ADD COLUMN "net_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_durations" ADD COLUMN "min_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_durations" ADD COLUMN "max_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_types" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "tax_types" ADD COLUMN "compound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_types" ADD COLUMN "invoice_label" text;--> statement-breakpoint
ALTER TABLE "tax_types" ADD COLUMN "display_group" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "levy_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_levies" ADD CONSTRAINT "property_levies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_levies" ADD CONSTRAINT "property_levies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stay_registrations" ADD CONSTRAINT "stay_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stay_registrations" ADD CONSTRAINT "stay_registrations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stay_registrations" ADD CONSTRAINT "stay_registrations_form_c_submitted_by_user_id_users_id_fk" FOREIGN KEY ("form_c_submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folio_charges_levy_night_uq" ON "folio_charges" USING btree ("folio_id","levy_code","booking_date") WHERE "folio_charges"."levy_code" is not null and "folio_charges"."voided_at" is null;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tax_mode_valid" CHECK ("properties"."tax_mode" in ('inclusive_legacy', 'exclusive_forward'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_profile_valid" CHECK ("invoices"."profile" in ('lk_vat', 'generic', 'in_gst', 'my_sst'));--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_levy_night" CHECK ("folio_charges"."levy_code" is null or "folio_charges"."booking_date" is not null);--> statement-breakpoint
-- Enum values must be added after statements that can run in the migration transaction.
ALTER TYPE "public"."charge_source" ADD VALUE IF NOT EXISTS 'levy';
