ALTER TABLE "properties" ADD COLUMN "property_type" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address_line_2" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "reservation_phone" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "fax" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "additional_registration_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_coordinates_pair" CHECK (("properties"."latitude" is null and "properties"."longitude" is null) or ("properties"."latitude" is not null and "properties"."longitude" is not null and "properties"."latitude" between -90 and 90 and "properties"."longitude" between -180 and 180));
