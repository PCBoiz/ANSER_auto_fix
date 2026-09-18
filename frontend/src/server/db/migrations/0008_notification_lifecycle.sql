ALTER TABLE "notifications" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolution" text;--> statement-breakpoint
CREATE INDEX "notifications_open_idx" ON "notifications" USING btree ("kind","resolved_at");