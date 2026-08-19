CREATE TYPE "public"."distribution_mode" AS ENUM('yoho', 'standalone');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"trial_ends_at" timestamp with time zone,
	"seats" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_features_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "timezone" text DEFAULT 'Asia/Colombo' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "checkin_time" time DEFAULT '14:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "checkout_time" time DEFAULT '11:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "star_rating" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "logo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "distribution_mode" "distribution_mode" DEFAULT 'yoho' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
