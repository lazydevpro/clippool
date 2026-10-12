CREATE TABLE "allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"root" text NOT NULL,
	"wallet" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"proof" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_tx" text,
	"fail_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_meta" (
	"campaign_id" bigint PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"rules" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" bigint PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"token" text NOT NULL,
	"pool" numeric(78, 0) NOT NULL,
	"start_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"snapshot_time" bigint NOT NULL,
	"max_share_bps" integer NOT NULL,
	"min_views" bigint NOT NULL,
	"rules_hash" text NOT NULL,
	"root" text,
	"total_allocated" numeric(78, 0),
	"snapshot_hash" text,
	"root_posted_at" bigint,
	"dispute_ends_at" bigint,
	"claimed" numeric(78, 0) DEFAULT '0' NOT NULL,
	"remainder_refunded" boolean DEFAULT false NOT NULL,
	"unclaimed_swept" boolean DEFAULT false NOT NULL,
	"no_root_refunded" boolean DEFAULT false NOT NULL,
	"oracle_hold" boolean DEFAULT false NOT NULL,
	"oracle_note" text,
	"root_tx" text,
	"create_tx" text,
	"created_block" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_wallets" (
	"campaign_id" bigint NOT NULL,
	"channel_id" text NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"json" jsonb,
	"hash" text NOT NULL,
	"root" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"video_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"title" text NOT NULL,
	"thumbnail_url" text,
	"wallet" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"duration_sec" integer NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"submission_id" bigint NOT NULL,
	"views" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_meta" ADD CONSTRAINT "campaign_meta_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_wallets" ADD CONSTRAINT "channel_wallets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_observations" ADD CONSTRAINT "view_observations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_campaign_wallet_uq" ON "allocations" USING btree ("campaign_id","wallet");--> statement-breakpoint
CREATE INDEX "allocations_status_idx" ON "allocations" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_wallets_campaign_channel_uq" ON "channel_wallets" USING btree ("campaign_id","channel_id");--> statement-breakpoint
CREATE INDEX "snapshots_campaign_idx" ON "snapshots" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_campaign_video_accepted_uq" ON "submissions" USING btree ("campaign_id","video_id") WHERE "submissions"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "submissions_campaign_idx" ON "submissions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "view_observations_submission_fetched_idx" ON "view_observations" USING btree ("submission_id","fetched_at");--> statement-breakpoint
CREATE INDEX "view_observations_fetched_idx" ON "view_observations" USING btree ("fetched_at");