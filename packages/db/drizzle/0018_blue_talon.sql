ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'LKR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "currency" text DEFAULT 'LKR' NOT NULL;