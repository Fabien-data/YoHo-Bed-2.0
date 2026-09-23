CREATE TABLE IF NOT EXISTS "smart_property_policies" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"published" jsonb,
	"published_version" integer,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_policy_versions_valid" CHECK ("smart_property_policies"."draft_version" > 0 and ("smart_property_policies"."published_version" is null or "smart_property_policies"."published_version" <= "smart_property_policies"."draft_version"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hotel_role_assignments" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"role_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hotel_role_properties" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	CONSTRAINT "hotel_role_properties_role_id_property_id_pk" PRIMARY KEY("role_id","property_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hotel_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_roles_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "room_units" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "ota_reservations" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ota_reservations" ADD COLUMN "review_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_property_policies" ADD CONSTRAINT "smart_property_policies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_property_policies" ADD CONSTRAINT "smart_property_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_assignments" ADD CONSTRAINT "hotel_role_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_assignments" ADD CONSTRAINT "hotel_role_assignments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_assignments" ADD CONSTRAINT "hotel_role_assignments_role_id_hotel_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."hotel_roles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_properties" ADD CONSTRAINT "hotel_role_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_properties" ADD CONSTRAINT "hotel_role_properties_role_id_hotel_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."hotel_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_role_properties" ADD CONSTRAINT "hotel_role_properties_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hotel_roles" ADD CONSTRAINT "hotel_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
