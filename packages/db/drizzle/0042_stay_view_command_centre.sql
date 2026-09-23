-- Stay View command centre. A block says what it is for, and room and date changes made on the
-- calendar are recorded on the reservation's own trail.
ALTER TABLE "maintenance_blocks" ADD COLUMN "kind" text DEFAULT 'out_of_service' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_kind_valid" CHECK ("maintenance_blocks"."kind" in ('out_of_service', 'blocked'));--> statement-breakpoint
-- Enum values last: Postgres 16 refuses a value added earlier in the same transaction, and a
-- fresh migrate runs every migration in one.
ALTER TYPE "public"."booking_action" ADD VALUE 'room_assigned';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'room_moved';--> statement-breakpoint
ALTER TYPE "public"."booking_action" ADD VALUE 'stay_changed';
