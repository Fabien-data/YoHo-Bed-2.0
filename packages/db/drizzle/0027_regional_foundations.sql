-- Development Phase 02, Sprint 1: regional foundations and the reservation master lists.
--
-- (drizzle-kit also proposed `ALTER TYPE message_status ADD VALUE 'sending'` here, because 0026
-- added that value by hand and its snapshot never recorded it. The value already exists, and an
-- ADD VALUE may never run mid-migration, so the statement was removed; the 0027 snapshot now
-- carries it and the drift is closed.)
CREATE TABLE IF NOT EXISTS "market_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"grp" text DEFAULT 'transient' NOT NULL,
	"palette" text DEFAULT 'slate' NOT NULL,
	"excluded_from_sold" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_segments_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "market_segments_grp_valid" CHECK ("market_segments"."grp" in ('transient', 'group', 'contract', 'non_revenue'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"requires_reference" boolean DEFAULT false NOT NULL,
	"is_default_cash" boolean DEFAULT false NOT NULL,
	"is_guest_advance" boolean DEFAULT false NOT NULL,
	"currency" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "payment_methods_category_valid" CHECK ("payment_methods"."category" in ('cash', 'card', 'bank_transfer', 'qr', 'wallet', 'cheque', 'city_ledger', 'online', 'other'))
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "country_code" text DEFAULT 'LK' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "tax_ids" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "branch_code" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "fy_start_month" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "category" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "registration_no" text;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "default_market_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "commission_plan" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "commission_value" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "palette" text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "collects_tourism_tax" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_sources" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "registration_no" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "commission_plan" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "commission_value" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "discount_pct" numeric(6, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "default_market_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "payment_terms_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_segments" ADD CONSTRAINT "market_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_default_market_segment_id_market_segments_id_fk" FOREIGN KEY ("default_market_segment_id") REFERENCES "public"."market_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_default_market_segment_id_market_segments_id_fk" FOREIGN KEY ("default_market_segment_id") REFERENCES "public"."market_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_fy_start_month_valid" CHECK ("properties"."fy_start_month" between 1 and 12);--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_country_code_shape" CHECK ("properties"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_category_valid" CHECK ("business_sources"."category" in ('direct', 'ota', 'travel_agent', 'corporate'));--> statement-breakpoint
ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_commission_plan_valid" CHECK ("business_sources"."commission_plan" in ('none', 'pct_all_nights', 'pct_first_night', 'fixed_per_night', 'fixed_per_stay'));--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_commission_plan_valid" CHECK ("ledger_accounts"."commission_plan" in ('none', 'pct_all_nights', 'pct_first_night', 'fixed_per_night', 'fixed_per_stay'));--> statement-breakpoint

-- Hand-written from here (not tracked by drizzle-kit).
--
-- Back-fill the country code from the free-text country the Sprint 0 profile stored. Every live
-- property is Sri Lankan today, so the default ('LK') is right for anything unrecognised; the
-- owner can correct it on the profile screen until the property takes its first booking.
UPDATE "properties"
SET "country_code" = CASE
  WHEN lower(trim("country")) IN ('malaysia', 'my') THEN 'MY'
  WHEN lower(trim("country")) IN ('india', 'in', 'bharat') THEN 'IN'
  ELSE 'LK'
END
WHERE "country" IS NOT NULL AND trim("country") <> '';
--> statement-breakpoint

-- The Sprint 6 business sources predate categories: anything a hotel typed in by hand is most
-- likely an OTA name, but guessing is worse than the safe default, so they stay 'direct' and keep
-- their colour until the owner re-labels them. Seeded defaults arrive with the right category.
CREATE INDEX IF NOT EXISTS "business_sources_tenant_category_idx"
  ON "business_sources" ("tenant_id", "category", "sort");
