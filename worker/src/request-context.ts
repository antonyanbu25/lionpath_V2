/**
 * Per-request correlation ID — threaded through post-call handlers and logs.
 */

let activeCorrelationId: string | undefined;

export function correlationIdFromRequest(request: Request): string {
  const header =
    request.headers.get("X-Request-Id")?.trim() ||
    request.headers.get("X-Correlation-Id")?.trim();
  return header || crypto.randomUUID();
}

export function getCorrelationId(): string | undefined {
  return activeCorrelationId;
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
    activeCorrelationId = prev;
  }
}
