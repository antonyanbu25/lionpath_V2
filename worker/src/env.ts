import type { CostControlEnv } from "./cost-control-config";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";
import type { HistoryEnv } from "./history";
import type { RateLimitEnv } from "./rate-limit";

export interface Env extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv, RateLimitEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  /** When "0"/"false", skip Bearer token checks (local dummy auth + Firestore admin). Default: enforced. */
  FIREBASE_AUTH_ENFORCED?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  /** Cloud SQL connection string for the janus_app role (via Auth Proxy / PgBouncer). */
  DATABASE_URL?: string;
  /** firestore | dual | sql — read/write routing for the persistence layer. */
  PERSISTENCE_MODE?: string;
  /** pg Pool max connections (default 10). Keep max_instances x pool < Cloud SQL max_connections. */
  PG_POOL_MAX?: string;
  APOLLO_API_KEY?: string;
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
  VIDEO_PASS_ENABLED?: string;
  CALL_PAYLOAD_BUCKET?: string;
  /** Shared secret for Cloud Scheduler / VPS cron internal endpoints. */
  INTERNAL_CRON_SECRET?: string;
  /** Shared secret for the impersonation endpoint (non-production only). */
  IMPERSONATE_SECRET?: string;
  /** When "1", disables TLS cert verification on Postgres connections (QA only; refused at boot in production). */
  PG_SSL_INSECURE?: string;
  /** Score-dispute manager email — off unless "1"/"true". */
  DISPUTE_NOTIFY_ENABLED?: string;
  /** Resend (or compatible) API key — server-side only; never expose to browser. */
  EMAIL_PROVIDER_API_KEY?: string;
  /** From address for dispute notify, e.g. "LionPath <noreply@example.com>". */
  DISPUTE_NOTIFY_FROM?: string;
}
