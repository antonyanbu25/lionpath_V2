import type { CostControlEnv } from "./cost-control-config";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";
import type { HistoryEnv } from "./history";

export interface Env extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  /** When "0"/"false", skip Bearer token checks (local dummy auth + Firestore admin). Default: enforced. */
  FIREBASE_AUTH_ENFORCED?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  APOLLO_API_KEY?: string;
  VIDEO_PASS_ENABLED?: string;
  CALL_PAYLOAD_BUCKET?: string;
  /** Shared secret for Cloud Scheduler / VPS cron internal endpoints. */
  INTERNAL_CRON_SECRET?: string;
  /** Score-dispute manager email — off unless "1"/"true". */
  DISPUTE_NOTIFY_ENABLED?: string;
  /** Resend (or compatible) API key — server-side only; never expose to browser. */
  EMAIL_PROVIDER_API_KEY?: string;
  /** From address for dispute notify, e.g. "LionPath <noreply@example.com>". */
  DISPUTE_NOTIFY_FROM?: string;
  /** Freshdesk API key (Basic auth username). Server-side only. */
  FRESHDESK_API_KEY?: string;
  /** Freshdesk domain, e.g. "janus.freshdesk.com" or "janus". */
  FRESHDESK_DOMAIN?: string;
}
