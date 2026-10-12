CREATE TABLE "channel_owners" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"channel_title" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text DEFAULT 'oauth' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "proof" text DEFAULT 'code' NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_owners_wallet_idx" ON "channel_owners" USING btree ("wallet");