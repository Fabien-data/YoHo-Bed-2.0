CREATE TABLE IF NOT EXISTS "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text DEFAULT 'LKR' NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "currency" text DEFAULT 'LKR' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fx_rate_to_lkr" numeric(18, 8) DEFAULT '1' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchange_rates_pair_fetched_idx" ON "exchange_rates" USING btree ("base","quote","fetched_at");