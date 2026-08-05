import type { CostControlEnv } from "./cost-control-config";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";
import type { HistoryEnv } from "./history";

export interface Env extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  APOLLO_API_KEY?: string;
  VIDEO_PASS_ENABLED?: string;
  CALL_PAYLOAD_BUCKET?: string;
  /** Shared secret for Cloud Scheduler / VPS cron internal endpoints. */
  INTERNAL_CRON_SECRET?: string;
}
