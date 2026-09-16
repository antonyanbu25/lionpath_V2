/**
 * Timeout + abort propagation for outbound provider calls (astra-audit P10 / F-027).
 *
 * `fetch` has no default timeout in either Workers or Node. A provider that
 * accepts the connection and then never responds holds the request open until
 * the platform kills it — on Cloud Run that is the service timeout, so one hung
 * socket occupies a request slot for minutes. F-027 named three such calls;
 * a sweep of `worker/src` found ten files with unguarded fetches, including the
 * Firebase JWK fetch that every authenticated request depends on.
 *
 * Why a helper rather than an AbortController at each site: the correct version
 * has four parts that are easy to get wrong individually —
 *
 *   1. clear the timer in `finally`, or a slow-but-successful response leaks a
 *      pending timer (and on Node keeps the event loop alive);
 *   2. honour a caller-supplied signal too, so cancelling the parent operation
 *      cancels the provider call rather than orphaning it;
 *   3. distinguish "we gave up" from "the provider refused", because only the
 *      former is safely retryable on a non-idempotent call;
 *   4. never retry here — retry policy belongs to the caller, which is the only
 *      thing that knows whether its operation is idempotent.
 *
 * This deliberately does NOT retry. gemini-retry.ts already owns retry for
 * Gemini with per-workload budgets; adding a second retry layer underneath it
 * would multiply attempts invisibly.
 */

/** Error thrown when our own budget expired, as opposed to a provider error. */
export class ProviderTimeoutError extends Error {
  readonly name = "ProviderTimeoutError";
  /** True when OUR budget expired — safe to retry for idempotent operations. */
  readonly timedOut = true;
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
  }
}

/** Error thrown when the CALLER cancelled — never retry this. */
export class ProviderAbortedError extends Error {
  readonly name = "AbortError";
  readonly aborted = true;
  constructor(readonly label: string) {
    super(`${label} aborted by caller`);
  }
}

export interface FetchTimeoutOptions {
  /** Budget in ms. Pick from the caller's workload class, not a global default. */
  timeoutMs: number;
  /** For the error message and telemetry — e.g. "zoom.recordings". */
  label: string;
  /** Caller's cancellation signal, composed with the timeout. */
  signal?: AbortSignal | null;
}

/**
 * `fetch` with a hard budget and caller-cancellation propagation.
 *
 * Throws ProviderTimeoutError when the budget expires and ProviderAbortedError
 * when the caller cancels. Any other rejection is the provider's own error and
 * is rethrown unchanged, so existing error handling keeps working.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit & { signal?: AbortSignal | null } = {},
  opts: FetchTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, label } = opts;
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Compose the caller's signal so cancelling the parent cancels this call.
  const callerSignal = opts.signal ?? init.signal ?? null;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new ProviderAbortedError(label);
    }
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Our timer fired: report it as ours, not as an opaque AbortError, so the
    // caller can tell "we gave up" from "the caller cancelled".
    if (timedOut) throw new ProviderTimeoutError(label, timeoutMs);
    if (callerSignal?.aborted) throw new ProviderAbortedError(label);
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Default budgets by provider class. Named rather than numeric at call sites so
 * a reader can see the intent, and so a budget can be tuned in one place.
 *
 * Sized generously: the point is to bound a HUNG socket, not to fail slow-but-
 * working providers. Anything tighter risks converting a latency problem into a
 * correctness problem.
 */
export const PROVIDER_TIMEOUT_MS = {
  /** Token/JWK/metadata calls — small, fast, and on the critical auth path. */
  auth: 10_000,
  /** Embedding batches — sized by candidate count, bounded by the caller. */
  embeddings: 30_000,
  /** Zoom REST metadata (recordings list, token mint). */
  zoomApi: 20_000,
  /** Zoom media download (VTT transcripts can be large). */
  zoomDownload: 60_000,
  /** Transcript inference on uploaded media. */
  transcriptInfer: 120_000,
  /** LLM cache management (create/get/delete). */
  llmCache: 20_000,
  /** Batch job submission/polling. */
  llmBatch: 30_000,
  /** CRM / enrichment lookups. */
  enrichment: 20_000,
  /** Fire-and-forget outbound notifications. */
  notify: 10_000,
} as const;
