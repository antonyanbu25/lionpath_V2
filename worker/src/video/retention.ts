/** Retention helpers for Pass 2 staging + keyframes. */

export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
export const KEYFRAME_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function keyframeRetentionExpiresAt(nowMs = Date.now()): number {
  return nowMs + KEYFRAME_TTL_MS;
}

export function stagingRetentionExpiresAt(nowMs = Date.now()): number {
  return nowMs + STAGING_TTL_MS;
}
