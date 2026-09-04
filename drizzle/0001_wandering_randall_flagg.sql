CREATE TABLE "sample_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sample_item_name_unique" ON "sample_item" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sample_item_archived_idx" ON "sample_item" USING btree ("archived");