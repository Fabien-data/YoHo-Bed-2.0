ALTER TYPE "public"."booking_action" ADD VALUE 'checked_in';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'checked_out';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'amended';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'CheckedIn' BEFORE 'Rejected';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'CheckedOut' BEFORE 'Rejected';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "checked_out_at" timestamp with time zone;