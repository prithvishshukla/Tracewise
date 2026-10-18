CREATE TYPE "public"."call_site_kind" AS ENUM('sdk_call', 'sdk_import', 'http_call', 'endpoint_literal', 'dynamic_call');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('breaking', 'deprecation', 'warning', 'informational');--> statement-breakpoint
CREATE TYPE "public"."dependency_source" AS ENUM('manifest', 'lockfile');--> statement-breakpoint
CREATE TYPE "public"."detection_method" AS ENUM('typescript_ast', 'tree_sitter', 'regex_fallback', 'manifest');--> statement-breakpoint
CREATE TYPE "public"."ecosystem" AS ENUM('npm', 'pypi');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'snoozed', 'fixed', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."match_kind" AS ENUM('exact_symbol', 'known_endpoint', 'api_path', 'package_version', 'pattern', 'dynamic_prefix');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('demo', 'live');--> statement-breakpoint
CREATE TYPE "public"."repo_source" AS ENUM('local', 'git');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('fixture_events', 'rss', 'atom', 'openapi');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"line" integer NOT NULL,
	"symbol" text NOT NULL,
	"kind" "call_site_kind" NOT NULL,
	"snippet" text NOT NULL,
	"snippet_start_line" integer NOT NULL,
	"detection_method" "detection_method" NOT NULL,
	"confidence" real NOT NULL,
	"resolved" boolean DEFAULT true NOT NULL,
	"file_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"source_id" uuid,
	"snapshot_id" uuid,
	"previous_snapshot_id" uuid,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"change_type" "change_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"affected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text NOT NULL,
	"detection_method" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" "origin" NOT NULL,
	"remediation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detected_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"provider_id" uuid,
	"package_name" text NOT NULL,
	"version_spec" text,
	"resolved_version" text,
	"ecosystem" "ecosystem" NOT NULL,
	"manifest_path" text NOT NULL,
	"manifest_line" integer,
	"source" "dependency_source" NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"change_event_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"call_site_id" uuid,
	"first_scan_id" uuid,
	"last_seen_scan_id" uuid,
	"title" text NOT NULL,
	"severity" "severity" NOT NULL,
	"confidence" real NOT NULL,
	"match_kind" "match_kind" NOT NULL,
	"match_reason" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limitations" text NOT NULL,
	"remediation" text NOT NULL,
	"file_path" text NOT NULL,
	"line" integer,
	"snippet" text NOT NULL,
	"snippet_start_line" integer,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"status_note" text,
	"snoozed_until" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexed_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL,
	"origin" "origin" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_content_hash" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"docs_url" text NOT NULL,
	"description" text NOT NULL,
	"packages" jsonb NOT NULL,
	"hosts" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_type" "repo_source" NOT NULL,
	"location" text NOT NULL,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"files_indexed" integer DEFAULT 0 NOT NULL,
	"dependencies_count" integer DEFAULT 0 NOT NULL,
	"call_sites_count" integer DEFAULT 0 NOT NULL,
	"findings_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"previous_snapshot_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_sites" ADD CONSTRAINT "call_sites_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sites" ADD CONSTRAINT "call_sites_scan_id_repository_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repository_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sites" ADD CONSTRAINT "call_sites_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_source_id_provider_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."provider_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_previous_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("previous_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_dependencies" ADD CONSTRAINT "detected_dependencies_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_dependencies" ADD CONSTRAINT "detected_dependencies_scan_id_repository_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repository_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_dependencies" ADD CONSTRAINT "detected_dependencies_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_change_event_id_change_events_id_fk" FOREIGN KEY ("change_event_id") REFERENCES "public"."change_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_call_site_id_call_sites_id_fk" FOREIGN KEY ("call_site_id") REFERENCES "public"."call_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_first_scan_id_repository_scans_id_fk" FOREIGN KEY ("first_scan_id") REFERENCES "public"."repository_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_last_seen_scan_id_repository_scans_id_fk" FOREIGN KEY ("last_seen_scan_id") REFERENCES "public"."repository_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexed_files" ADD CONSTRAINT "indexed_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexed_files" ADD CONSTRAINT "indexed_files_scan_id_repository_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repository_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sources" ADD CONSTRAINT "provider_sources_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_scans" ADD CONSTRAINT "repository_scans_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_source_id_provider_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."provider_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_previous_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("previous_snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "call_sites_repo_idx" ON "call_sites" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "call_sites_provider_symbol_idx" ON "call_sites" USING btree ("provider_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "change_events_fingerprint_uq" ON "change_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "change_events_provider_idx" ON "change_events" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "change_events_detected_idx" ON "change_events" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "change_events_severity_idx" ON "change_events" USING btree ("severity");--> statement-breakpoint
CREATE UNIQUE INDEX "detected_deps_uq" ON "detected_dependencies" USING btree ("scan_id","ecosystem","package_name","manifest_path","source");--> statement-breakpoint
CREATE INDEX "detected_deps_repo_idx" ON "detected_dependencies" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_fingerprint_uq" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "findings_status_idx" ON "findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "findings_severity_idx" ON "findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "findings_repo_idx" ON "findings" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "findings_change_idx" ON "findings" USING btree ("change_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_files_scan_path_uq" ON "indexed_files" USING btree ("scan_id","path");--> statement-breakpoint
CREATE INDEX "indexed_files_repo_idx" ON "indexed_files" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_records_queue_job_uq" ON "job_records" USING btree ("queue","job_id");--> statement-breakpoint
CREATE INDEX "job_records_status_idx" ON "job_records" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sources_provider_url_uq" ON "provider_sources" USING btree ("provider_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_location_uq" ON "repositories" USING btree ("location");--> statement-breakpoint
CREATE INDEX "repository_scans_repo_idx" ON "repository_scans" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_source_hash_uq" ON "source_snapshots" USING btree ("source_id","content_hash");