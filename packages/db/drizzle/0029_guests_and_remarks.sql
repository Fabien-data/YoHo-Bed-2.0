-- Development Phase 02, Sprint 4: the full Add Reservation page and the Reservations list.
--
-- booking_guests    the other people sharing a room (the booking's customer is the main guest)
-- guest_documents   ID documents checked at the desk; Aadhaar kept as its last 4 digits only
-- booking_remarks   typed notes on a booking (front desk, housekeeping, accounts, ...)
-- work_orders       + booking_id, department and trigger: "Create Task" from a room line
--
-- New tables only, plus nullable/defaulted columns on work_orders: nothing existing is rewritten.
-- RLS for the three tables is in rls.sql.
CREATE TABLE IF NOT EXISTS "booking_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_guests_booking_customer_uq" UNIQUE("booking_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_remarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"text" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_remarks_type_valid" CHECK ("booking_remarks"."type" in ('general', 'front_desk', 'housekeeping', 'accounts', 'kitchen', 'preference')),
	CONSTRAINT "booking_remarks_text_not_blank" CHECK (length(btrim("booking_remarks"."text")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guest_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"issuing_country" text,
	"place_of_issue" text,
	"issued_on" date,
	"expires_on" date,
	"visa_number" text,
	"visa_type" text,
	"visa_expires_on" date,
	"verification" text,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_documents_type_valid" CHECK ("guest_documents"."type" in ('nic', 'mykad', 'mypr', 'aadhaar', 'passport', 'driving_licence', 'voter_id', 'oci', 'other')),
	CONSTRAINT "guest_documents_aadhaar_last_four" CHECK ("guest_documents"."type" <> 'aadhaar' or "guest_documents"."number" ~ '^[0-9]{4}$'),
	CONSTRAINT "guest_documents_verification_valid" CHECK ("guest_documents"."verification" is null or "guest_documents"."verification" in ('original', 'copy', 'digital'))
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "department" text DEFAULT 'maintenance' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "trigger" text DEFAULT 'instant' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_remarks" ADD CONSTRAINT "booking_remarks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_remarks" ADD CONSTRAINT "booking_remarks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_remarks" ADD CONSTRAINT "booking_remarks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_documents" ADD CONSTRAINT "guest_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_documents" ADD CONSTRAINT "guest_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_documents" ADD CONSTRAINT "guest_documents_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_guests_customer_idx" ON "booking_guests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_remarks_booking_idx" ON "booking_remarks" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_documents_customer_idx" ON "guest_documents" USING btree ("customer_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_booking_idx" ON "work_orders" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_department_valid" CHECK ("work_orders"."department" in ('housekeeping', 'maintenance', 'front_desk', 'food_beverage', 'transport', 'other'));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_trigger_valid" CHECK ("work_orders"."trigger" in ('instant', 'checkin', 'checkout'));