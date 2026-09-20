-- Development Phase 02, Sprint 6: invoices and the guest booking page.
--
-- invoices         number unique per property (was global); kind (legacy/tax_invoice/invoice/bill/
--                  proforma/credit_note), profile (lk_vat/generic), the folio window it bills,
--                  credit notes (original + reason; credited_at on the original), supplier and
--                  purchaser snapshots, dates, totals, per-tax summary, FX to the local currency.
--                  Every existing row is an `INV-<reference>` and keeps kind 'legacy'.
-- invoice_lines    quantity, unit price, net/tax/tax_lines, SAC code, the date and folio charge.
-- voucher_tokens   the guest booking page link. NO RLS, like review_invites: the token is the key.
--
-- The starter voucher and check-out templates are added per tenant by migrate.ts, not here.

CREATE TABLE IF NOT EXISTS "voucher_tokens" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_number_unique";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "quantity" numeric(10, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "net" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax_lines" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "hsn_sac" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "posted_for" date;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "folio_charge_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "profile" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "folio_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "original_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credit_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supplier" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payer" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fiscal_year" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supply_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subtotal" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rounding" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_summary" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_quote" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voucher_tokens" ADD CONSTRAINT "voucher_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voucher_tokens" ADD CONSTRAINT "voucher_tokens_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voucher_tokens" ADD CONSTRAINT "voucher_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voucher_tokens" ADD CONSTRAINT "voucher_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voucher_tokens_booking_idx" ON "voucher_tokens" USING btree ("booking_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_folio_charge_id_folio_charges_id_fk" FOREIGN KEY ("folio_charge_id") REFERENCES "public"."folio_charges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_folio_idx" ON "invoices" USING btree ("folio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_booking_idx" ON "invoices" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_number_uq" UNIQUE("property_id","number");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_valid" CHECK ("invoices"."kind" in ('legacy', 'tax_invoice', 'invoice', 'bill', 'proforma', 'credit_note'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_profile_valid" CHECK ("invoices"."profile" in ('lk_vat', 'generic'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_note_original" CHECK ("invoices"."kind" <> 'credit_note' or ("invoices"."original_invoice_id" is not null and length(trim(coalesce("invoices"."credit_reason", ''))) > 0));
--> statement-breakpoint
-- A folio window is invoiced once: one live document of each folio kind. A credit note stamps
-- credited_at on the invoice it cancels, which frees the window to be invoiced again.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_folio_live_uq" ON "invoices" ("folio_id", "kind")
  WHERE "folio_id" IS NOT NULL AND "credited_at" IS NULL
    AND "kind" IN ('tax_invoice', 'invoice', 'bill');
--> statement-breakpoint
-- Window 1 bills its booking's guest unless Bill To chose otherwise. Windows opened on demand
-- between 0030 and this fix were left without the guest; name them now.
UPDATE "folios" f SET "payer_customer_id" = b."customer_id"
  FROM "bookings" b
  WHERE b."id" = f."booking_id" AND f."window" = 1 AND f."payer_type" = 'guest'
    AND f."payer_customer_id" IS NULL;
