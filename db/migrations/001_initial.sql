CREATE TABLE IF NOT EXISTS export_requests (
 id uuid PRIMARY KEY, actor_id text NOT NULL, idempotency_key text NOT NULL,
 payload_hash text NOT NULL, state text NOT NULL CHECK (state IN ('queued','processing','completed','failed','cancelled')),
 filters_json jsonb NOT NULL, snapshot_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), processed_count integer NOT NULL DEFAULT 0,
 error_code text, retryable boolean NOT NULL DEFAULT false, UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS jobs (
 request_id uuid PRIMARY KEY REFERENCES export_requests(id), attempt integer NOT NULL DEFAULT 0,
 fencing_token integer NOT NULL DEFAULT 0, lease_owner text, lease_until timestamptz, heartbeat_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(next_attempt_at,lease_until);
CREATE INDEX IF NOT EXISTS exports_actor_created ON export_requests(actor_id,created_at,id);
CREATE TABLE IF NOT EXISTS documents (
 id text PRIMARY KEY, owner_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('invoice','report')),
 issued_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), object_key text NOT NULL,
 bytes integer NOT NULL CHECK(bytes >= 0), payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_cursor ON documents(owner_id,issued_at,id);
CREATE TABLE IF NOT EXISTS artifacts (
 request_id uuid PRIMARY KEY REFERENCES export_requests(id), object_key text NOT NULL UNIQUE,
 checksum text NOT NULL, document_count integer NOT NULL, bytes bigint NOT NULL,
 duration_ms integer NOT NULL, peak_rss_bytes bigint NOT NULL, completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, request_id uuid NOT NULL REFERENCES export_requests(id),
 from_state text, to_state text NOT NULL, code text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS chromium_peak_rss_bytes bigint;
