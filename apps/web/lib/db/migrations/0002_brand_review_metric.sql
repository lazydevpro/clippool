ALTER TABLE "campaigns" ADD COLUMN "metric" text DEFAULT 'views' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "brand_review" text DEFAULT null;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "brand_review_note" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "brand_reviewed_at" timestamp with time zone;