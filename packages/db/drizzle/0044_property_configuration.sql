-- Property configuration, Yanolja style (owner brief, 2026-09-26): the Hotel Profile's other
-- tabs, the Room Type fields, the hotel's own Rate Types, and the Settings lists YoHoBed lacked —
-- Holidays, Guest Attributes, Discounts, saved Remarks and Payouts.
CREATE TABLE IF NOT EXISTS "rate_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_code" text NOT NULL,
	"meal_plan" text DEFAULT 'RO' NOT NULL,
	"add_ons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_types_property_code_uq" UNIQUE("property_id","short_code"),
	CONSTRAINT "rate_types_meal_plan_valid" CHECK ("rate_types"."meal_plan" in ('RO', 'BB', 'HB', 'FB', 'AI'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_attributes" (
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_attributes_customer_id_attribute_id_pk" PRIMARY KEY("customer_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'percent' NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_property_code_uq" UNIQUE("property_id","code"),
	CONSTRAINT "discounts_kind_valid" CHECK ("discounts"."kind" in ('percent', 'amount')),
	CONSTRAINT "discounts_value_valid" CHECK ("discounts"."value" > 0 and ("discounts"."kind" <> 'percent' or "discounts"."value" <= 100))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guest_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_property_date_name_uq" UNIQUE("property_id","date","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_types_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "payout_types_category_valid" CHECK ("payout_types"."category" in ('supplies', 'maintenance', 'transport', 'staff', 'utilities', 'other'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remark_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"text" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remark_templates_type_valid" CHECK ("remark_templates"."type" in ('general', 'front_desk', 'housekeeping', 'accounts', 'kitchen', 'preference'))
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "policies" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "short_code" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "base_adults" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "base_children" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "max_adults" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "max_children" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "bed_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD COLUMN "rate_type_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_vouchers" ADD COLUMN "payout_type_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_types" ADD CONSTRAINT "rate_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_types" ADD CONSTRAINT "rate_types_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_attributes" ADD CONSTRAINT "customer_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_attributes" ADD CONSTRAINT "customer_attributes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_attributes" ADD CONSTRAINT "customer_attributes_attribute_id_guest_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."guest_attributes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discounts" ADD CONSTRAINT "discounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discounts" ADD CONSTRAINT "discounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_attributes" ADD CONSTRAINT "guest_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holidays" ADD CONSTRAINT "holidays_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_types" ADD CONSTRAINT "payout_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remark_templates" ADD CONSTRAINT "remark_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "guest_attributes_tenant_name_uq" ON "guest_attributes" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_rate_type_id_rate_types_id_fk" FOREIGN KEY ("rate_type_id") REFERENCES "public"."rate_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_payout_type_id_payout_types_id_fk" FOREIGN KEY ("payout_type_id") REFERENCES "public"."payout_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rooms_property_short_code_uq" ON "rooms" USING btree ("property_id",upper("short_code")) WHERE "rooms"."short_code" is not null;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_occupancy_valid" CHECK (coalesce("rooms"."base_adults", 0) >= 0 and coalesce("rooms"."base_children", 0) >= 0
      and coalesce("rooms"."max_adults", 0) >= 0 and coalesce("rooms"."max_children", 0) >= 0
      and ("rooms"."base_adults" is null or "rooms"."max_adults" is null or "rooms"."base_adults" <= "rooms"."max_adults")
      and ("rooms"."base_children" is null or "rooms"."max_children" is null or "rooms"."base_children" <= "rooms"."max_children"));--> statement-breakpoint
-- Room types keep the order the desk already sees (by name) until the owner drags them.
UPDATE "rooms" r
   SET sort_order = o.pos * 10
  FROM (SELECT id, row_number() OVER (PARTITION BY property_id ORDER BY name, created_at) AS pos
          FROM "rooms") o
 WHERE r.id = o.id;--> statement-breakpoint
-- Every meal plan a property already sells becomes one of its rate types ("BB · Bed & Breakfast"),
-- and each rate plan points at the one for its meal plan. Prices and the channels, which read the
-- meal plan, are untouched.
INSERT INTO "rate_types" (tenant_id, property_id, name, short_code, meal_plan, sort_order)
SELECT DISTINCT ON (rp.property_id, rc.code)
       rp.tenant_id, rp.property_id, rc.name, rc.code,
       CASE WHEN rc.code IN ('RO', 'BB', 'HB', 'FB', 'AI') THEN rc.code ELSE 'RO' END,
       rc.sort_order * 10
  FROM "rate_plans" rp
  JOIN "rate_codes" rc ON rc.id = rp.rate_code_id
 ORDER BY rp.property_id, rc.code
ON CONFLICT ON CONSTRAINT "rate_types_property_code_uq" DO NOTHING;--> statement-breakpoint
UPDATE "rate_plans" rp
   SET rate_type_id = rt.id
  FROM "rate_codes" rc, "rate_types" rt
 WHERE rc.id = rp.rate_code_id
   AND rt.property_id = rp.property_id
   AND rt.short_code = rc.code
   AND rp.rate_type_id IS NULL;
