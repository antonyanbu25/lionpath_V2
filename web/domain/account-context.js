/** Stash account/deal context when launching prep or post-call from account detail. */

const KEY = "lionpath-account-engagement-context";

/**
 * @param {{ accountId?: string, dealId?: string|null, prepType?: string, lifecycleId?: string|null }} ctx
 */
export function setAccountEngagementContext(ctx) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx || {}));
  } catch {
    /* ignore */
  }
}

/** @returns {{ accountId?: string, dealId?: string|null, prepType?: string, lifecycleId?: string|null }} */
export function getAccountEngagementContext() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function clearAccountEngagementContext() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
