-- Development Phase 02, Sprint 5: money at reservation, Bill To routing, stay services.
--
-- private_files       payment slips and ID scans, fenced by RLS (never the public media table)
-- document_sequences  gap-free receipt (and, from Sprint 6, invoice) numbers per property
-- transport_modes     the vehicles for pick-ups and drop-offs, seeded per tenant on migrate
-- booking_inclusions  breakfast, a driver's room ... posted by night audit
-- booking_transfers   pick-ups and drop-offs; charged when done
-- payments            + the hotel's own method, who took it, the slip, receipt number, split group
-- folios              + payer (guest / company / travel agent) and routed charge sources
-- folio_charges       + tax lines and the inclusion a line was posted for
-- guest_documents     + a scan in the private store
--
-- Existing rows are only added to: every folio is backfilled as the guest's own window, payer = the
-- booking's guest. The charge_source enum value is added LAST and no statement here uses it: all
-- pending migrations run in one transaction, and a new enum value cannot be used inside the
-- transaction that adds it.
CREATE TABLE IF NOT EXISTS "private_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"purpose" text DEFAULT 'other' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "private_files_purpose_valid" CHECK ("private_files"."purpose" in ('payment_slip', 'id_document', 'other'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"period" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_property_type_period_uq" UNIQUE("property_id","doc_type","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_inclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"particular_id" uuid,
	"name" text NOT NULL,
	"rhythm" text DEFAULT 'per_night' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"tax_rate_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"included_in_rate" boolean DEFAULT false NOT NULL,
	"itemize" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_inclusions_rhythm_valid" CHECK ("booking_inclusions"."rhythm" in ('once', 'per_night', 'per_guest_per_night', 'per_adult_per_night', 'per_child_per_night')),
	CONSTRAINT "booking_inclusions_discount_valid" CHECK ("booking_inclusions"."discount_pct" >= 0 and "booking_inclusions"."discount_pct" <= 100),
	CONSTRAINT "booking_inclusions_price_valid" CHECK ("booking_inclusions"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"transport_mode_id" uuid,
	"scheduled_at" timestamp with time zone,
	"from_place" text,
	"to_place" text,
	"flight_no" text,
	"pax" integer DEFAULT 1 NOT NULL,
	"vehicle" text,
	"driver" text,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"charge_id" uuid,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_transfers_direction_valid" CHECK ("booking_transfers"."direction" in ('pickup', 'dropoff')),
	CONSTRAINT "booking_transfers_status_valid" CHECK ("booking_transfers"."status" in ('planned', 'done', 'cancelled')),
	CONSTRAINT "booking_transfers_pax_valid" CHECK ("booking_transfers"."pax" >= 1 and "booking_transfers"."pax" <= 60),
	CONSTRAINT "booking_transfers_amount_valid" CHECK ("booking_transfers"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transport_modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_modes_tenant_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "guest_documents" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_method_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method_code" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "taken_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "attachment_file_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_no" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "allocation_group_id" uuid;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "tax_lines" jsonb;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "booking_inclusion_id" uuid;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "payer_type" text DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "payer_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "payer_ledger_account_id" uuid;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "routes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_files" ADD CONSTRAINT "private_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_files" ADD CONSTRAINT "private_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_inclusions" ADD CONSTRAINT "booking_inclusions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_inclusions" ADD CONSTRAINT "booking_inclusions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_inclusions" ADD CONSTRAINT "booking_inclusions_particular_id_charge_particulars_id_fk" FOREIGN KEY ("particular_id") REFERENCES "public"."charge_particulars"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_inclusions" ADD CONSTRAINT "booking_inclusions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_transfers" ADD CONSTRAINT "booking_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_transfers" ADD CONSTRAINT "booking_transfers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_transfers" ADD CONSTRAINT "booking_transfers_transport_mode_id_transport_modes_id_fk" FOREIGN KEY ("transport_mode_id") REFERENCES "public"."transport_modes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_transfers" ADD CONSTRAINT "booking_transfers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transport_modes" ADD CONSTRAINT "transport_modes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "private_files_tenant_idx" ON "private_files" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_inclusions_booking_idx" ON "booking_inclusions" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_transfers_booking_idx" ON "booking_transfers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_transfers_scheduled_idx" ON "booking_transfers" USING btree ("scheduled_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_documents" ADD CONSTRAINT "guest_documents_file_id_private_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."private_files"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_taken_by_user_id_users_id_fk" FOREIGN KEY ("taken_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_attachment_file_id_private_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."private_files"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_payer_customer_id_customers_id_fk" FOREIGN KEY ("payer_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_receipt_idx" ON "payments" USING btree ("tenant_id","receipt_no");--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_payer_type_valid" CHECK ("folios"."payer_type" in ('guest', 'company', 'travel_agent'));
--> statement-breakpoint
-- Foreign keys the TypeScript schema cannot declare without an import cycle between modules.
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_payer_ledger_account_id_fk" FOREIGN KEY ("payer_ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_booking_inclusion_id_fk" FOREIGN KEY ("booking_inclusion_id") REFERENCES "public"."booking_inclusions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_transfers" ADD CONSTRAINT "booking_transfers_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."folio_charges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_payer_ledger_account_idx" ON "folios" USING btree ("payer_ledger_account_id") WHERE "payer_ledger_account_id" IS NOT NULL;
--> statement-breakpoint
-- One live posting per inclusion per night: night audit may be retried, and a double-posted
-- breakfast is a complaint at check-out.
CREATE UNIQUE INDEX IF NOT EXISTS "folio_charges_inclusion_night_uq"
  ON "folio_charges" ("booking_inclusion_id", "posted_for")
  WHERE "voided_at" IS NULL AND "booking_inclusion_id" IS NOT NULL;
--> statement-breakpoint
-- Every existing window is the guest's own bill.
UPDATE "folios" f SET "payer_customer_id" = b."customer_id"
  FROM "bookings" b
  WHERE b."id" = f."booking_id" AND f."payer_customer_id" IS NULL;
--> statement-breakpoint
ALTER TYPE "public"."charge_source" ADD VALUE IF NOT EXISTS 'inclusion';
