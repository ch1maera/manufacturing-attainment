CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."corrective_actions_seed" (
	"action_id" text PRIMARY KEY NOT NULL,
	"miss_id" text,
	"plant_id" text,
	"plant_name" text,
	"region" text,
	"sku_name" text,
	"reason_code" text,
	"miss_date" date,
	"action_desc" text,
	"owner" text,
	"implementation_date" date,
	"ca_status" text
);
--> statement-breakpoint
CREATE TABLE "app"."feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"value" text NOT NULL,
	"rationale" text,
	"trace_id" text,
	"mlflow_assessment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"trace_id" text,
	"thinking" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"canceled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."misses" (
	"id" text PRIMARY KEY NOT NULL,
	"miss_date" date,
	"plant_id" text,
	"plant_name" text,
	"region" text,
	"line_id" text,
	"line_name" text,
	"sku_id" text,
	"sku_name" text,
	"category" text,
	"miss_units" integer,
	"reason_code" text,
	"comment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"corrective_action_desc" text,
	"corrective_action_owner" text,
	"corrective_action_impl_date" date,
	"corrective_action_status" text,
	"ai_audit_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."plants" (
	"id" text PRIMARY KEY NOT NULL,
	"plant_name" text NOT NULL,
	"city" text,
	"state" text,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	"attainment_pct" double precision,
	"adherence_pct" double precision,
	"open_miss_count" integer,
	"open_miss_units" integer,
	"breakdowns_count" integer,
	"work_orders_count" integer,
	"maintenance_spend_usd" double precision,
	"first_pass_quality_pct" double precision,
	"holds_count" integer
);
--> statement-breakpoint
ALTER TABLE "app"."feedback" ADD CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "app"."conversations" USING btree ("user_email","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_kind_idx" ON "app"."conversations" USING btree ("user_email","kind");--> statement-breakpoint
CREATE INDEX "ca_seed_status_idx" ON "app"."corrective_actions_seed" USING btree ("ca_status");--> statement-breakpoint
CREATE INDEX "feedback_message_idx" ON "app"."feedback" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_convo_pos_uq" ON "app"."messages" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE INDEX "misses_status_idx" ON "app"."misses" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "misses_plant_idx" ON "app"."misses" USING btree ("plant_id","status");--> statement-breakpoint
CREATE INDEX "misses_reason_idx" ON "app"."misses" USING btree ("reason_code");--> statement-breakpoint
CREATE INDEX "misses_date_idx" ON "app"."misses" USING btree ("miss_date");--> statement-breakpoint
CREATE INDEX "plants_region_idx" ON "app"."plants" USING btree ("region");