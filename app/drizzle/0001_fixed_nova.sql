CREATE TABLE "app"."reason_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."misses" ADD COLUMN "production_order" text;--> statement-breakpoint
ALTER TABLE "app"."misses" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "app"."misses" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."misses" ADD COLUMN "resolution_note" text;--> statement-breakpoint
CREATE INDEX "reason_codes_active_idx" ON "app"."reason_codes" USING btree ("active","sort_order");