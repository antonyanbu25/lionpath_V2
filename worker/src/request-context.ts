/**
 * Per-request correlation ID — threaded through post-call handlers and logs.
 */

import type { AssumeIdentityClaims } from "./auth";

let activeCorrelationId: string | undefined;
const assumeByCorrelationId = new Map<string, AssumeIdentityClaims>();

export function correlationIdFromRequest(request: Request): string {
  const header =
    request.headers.get("X-Request-Id")?.trim() ||
    request.headers.get("X-Correlation-Id")?.trim();
  return header || crypto.randomUUID();
}

export function getCorrelationId(): string | undefined {
  return activeCorrelationId;
}

export function setAssumeIdentityForRequest(claims: AssumeIdentityClaims | undefined): void {
  if (!activeCorrelationId) return;
  if (claims) {
    assumeByCorrelationId.set(activeCorrelationId, claims);
  } else {
    assumeByCorrelationId.delete(activeCorrelationId);
  }
}

export function getAssumeIdentityForRequest(): AssumeIdentityClaims | undefined {
  if (!activeCorrelationId) return undefined;
  return assumeByCorrelationId.get(activeCorrelationId);
}

export async function runWithRequestContext<T>(
  correlationId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev = activeCorrelationId;
  activeCorrelationId = correlationId;
  try {
    return await fn();
  } finally {
    assumeByCorrelationId.delete(correlationId);
    activeCorrelationId = prev;
  }
}
