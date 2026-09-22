ALTER TABLE "booking_approvals" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD COLUMN "voided_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- Enum values last: Postgres 16 refuses a value added earlier in the same transaction, and a
-- fresh migrate runs every migration in one.
ALTER TYPE "public"."booking_action" ADD VALUE 'check_in_undone';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'check_out_undone';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'reinstated';
