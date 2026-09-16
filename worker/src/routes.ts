import { requireUser, resolveHistoryEmail, resolveHistoryEmailForWrite, assertManagerProxyOwnerEmail } from "./auth";
import { stampVerifiedUsageIdentity } from "./data/llm-usage";
import { deterministicAppendId } from "./data/persistence/idempotency";
import { isValidCompanyDomain, normalizeCompanyDomain } from "./domain";
import {
  appendFeedback,
  feedbackStorageAvailable,
  loadGlobalFeedback,
  loadFeedback,
  normalizeFeedbackCategory,
  type FeedbackEntry,
} from "./feedback";
import { emailNotifyAvailable, sendManagerDisputeEmail } from "./notify-email";
import {
  buildTicketCustomFields,
  buildTicketDescriptionHtml,
  createFreshdeskTicket,
  defaultSubjectForKind,
  freshdeskConfigured,
  mapDisputeIssueType,
  MAX_ATTACHMENT_BYTES,
  ticketTypeForKind,
  type FreshdeskTicketKind,
} from "./freshdesk";
import {
  historyStorageAvailable,
  historyStorageKind,
  loadHistory,
  replaceHistory,
  saveHistoryEntry,
  type HistoryEntry,
} from "./history";
import { json } from "./http";
import { fetchKaiaShareContent } from "./kaia/fetchShareContent";
import {
  runPostCallClassify,
  runPostCallConfirmedPipeline,
  runPostCallLegacyAnalyze,
  runPostCallResolve,
  runPostCallSummarise,
  runPostCallQualify,
  runPostCallCommit,
  runPostCallSummaries,
  runPostCallArrInputs,
  runPostCallArrCompute,
  runPostCallGaps,
  deriveCallTimeline,
  type TimelineMarkerSources,
  type PostCallClassifyInput,
  type PostCallGenerateInput,
  type PostCallResolveInput,
  type PostCallResolveResult,
  type PostCallSummariseInput,
  type PostCallQualifyInput,
  type PostCallCommitInput,
  type PostCallSummariesInput,
  type PostCallArrInputsInput,
  type PostCallArrComputeInput,
  type PostCallGapsInput,
} from "./postcall/index";
import type { PostCallResolveOptions } from "./postcall/resolve";
import { runGapClustering, type RunClusteringInput } from "./product-signal/index";
import {
  generatePrep,
  resolveProspectEmails,
  runPrepResearch,
  runPrepSynthesize,
  type PrepInput,
} from "./prep";
import { effectiveGeminiModel } from "./providers/gemini";
import { enrichContact, type ContactEnrichRequest } from "./contact/enrich";
import {
  deleteTask,
  loadTasks,
  patchTask,
  saveTasks,
  tasksStorageAvailable,
  upsertTask,
  type Task,
} from "./tasks";
import { fetchRecordingFromShareLink } from "./zoomShare";
import { zoomAuthUrl, zoomApiConfigured, zoomConfigured } from "./zoom";
import { ffmpegAvailable, isNodeRuntime, videoPassEnvEnabled } from "./video/capability";
import { WORKER_BUILD, GEMINI_SCHEMA_ENUM_FIX } from "./build-id";
import { firestoreAdminReady, getDb, getDoc } from "./data/firestore-admin";
import { resolveRequestContext, assertCanReadResource, type RequestContext } from "./data/scope";
import { handleOrgStructureGet, handleOrgStructurePatch } from "./org-structure";
import { handleOutboxProjectPost } from "./routes/internal-outbox";
import { handleOutboxHealthGet } from "./routes/internal-outbox-health";
import { handleUsageRollupPost } from "./routes/internal-usage";
import { healthRoutes } from "./routes/health";
import { handleReadModelsSchedulePost } from "./routes/read-models";
import {
  handleBatchEnqueuePost,
  handleBatchFallbackPost,
  handleBatchPollPost,
  handleDealGraceSweepPost,
  handleReadModelsNightlyRebuildPost,
} from "./routes/internal-batch";
import { handleAdminLlmUsageGet } from "./routes/admin-llm-usage";
// NOTE: ./routes/analytics (handleDirectorAnalyticsGet) is deliberately NOT
// imported/registered here -- see the route table below for why.
import { fallback, logFallback } from "./data/persistence/fallback-log";
import { canonicalizeSeMotion } from "./rubric-profiles";
import type { VerifiedUser } from "./auth";
import { firebaseAuthEnforced } from "./auth";
import {
  createPostgresReadRepository,
  getPool,
  persistenceReadReady,
  postgresReady,
  resolvePersistencePort,
  accountWritableBySession,
  resolveSqlSession,
  resolveSqlSessionByEmail,
  withSessionContext,
} from "./data/persistence";
import { applyLifecycleEvent, type LifecycleEventInput } from "./data/persistence/lifecycle-events";
import { validateJsonbShape } from "./data/persistence/shapes";
import type { AccountRow, DealRow, PersistencePort } from "./data/persistence/types";
import type { PgClient } from "./data/persistence/postgres-pool";
import { seMotionFromPostCallDoc } from "./domain-model/se-motion";
import { handleRecoveryStatus, handleRecoveryUpload } from "./routes/recovery";
import { rerankWithEmbeddings, type RagCandidate } from "./search/rag-search";
import { domainReadRoutes, handleDealsListGet } from "./routes/domain-reads";
import type { Env } from "./env";

export type RouteHandler = (
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
) => Promise<Response>;

export async function handleZoomStatus(
  _request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  // `configured` used to report zoomConfigured (the user-OAuth triple, which has
  // no callback route and no caller anywhere) instead of zoomApiConfigured (the
  // Server-to-Server triple that actually fetches recordings). That meant a call
  // could display as "Zoom configured" while fetch was structurally impossible,
  // and vice versa (astra-audit F-039/E-106). `configured` now reports the
  // predicate that actually governs automatic fetch; both are still exposed
  // explicitly so nothing that inspects this response loses information.
  return json(
    {
      configured: zoomApiConfigured(env),
      apiConfigured: zoomApiConfigured(env),
      userOAuthConfigured: zoomConfigured(env),
    },
    200,
    cors,
  );
}

export async function handleConfig(
  _request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const prepProvider = env.LLM_PROVIDER || "gemini";
  const postcallProvider = env.POSTCALL_LLM_PROVIDER || prepProvider || "gemini";
  const prepModel = env.MODEL || "gemini-3.1-flash-lite";
  const postcallModel = env.POSTCALL_MODEL || "gemini-3.1-flash-lite";
  const ffmpegOk = isNodeRuntime() && (await ffmpegAvailable());
  return json(
    {
      workerBuild: WORKER_BUILD,
      geminiSchemaEnumFix: GEMINI_SCHEMA_ENUM_FIX,
      prep: {
        provider: prepProvider,
        model: prepModel,
        effectiveModel: prepProvider === "gemini" ? effectiveGeminiModel(env) : prepModel,
      },
      postcall: {
        provider: postcallProvider,
        model: postcallModel,
        effectiveModel:
          postcallProvider === "gemini"
            ? effectiveGeminiModel(env, env.POSTCALL_MODEL)
            : postcallModel,
      },
      // See handleZoomStatus above — configured now tracks the predicate that
      // actually governs automatic fetch (Server-to-Server), not the dead
      // user-OAuth stub.
      zoom: {
        configured: zoomApiConfigured(env),
        apiConfigured: zoomApiConfigured(env),
        userOAuthConfigured: zoomConfigured(env),
      },
      keys: {
        anthropic: !!env.ANTHROPIC_API_KEY,
        gemini: !!env.GEMINI_API_KEY || !!(env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT),
        zoominfo: !!env.ZOOMINFO_API_KEY,
      },
      history: {
        available: historyStorageAvailable(env),
        storage: historyStorageKind(env),
      },
      tasks: {
        available: tasksStorageAvailable(env),
        storage: historyStorageKind(env),
      },
      feedback: {
        available: feedbackStorageAvailable(env),
        storage: historyStorageKind(env),
      },
      freshdesk: {
        configured: freshdeskConfigured(env),
      },
      disputeNotify: {
        available: emailNotifyAvailable(env),
      },
      videoPass: {
        enabled: videoPassEnvEnabled(env),
        nodeRuntime: isNodeRuntime(),
        ffmpeg: ffmpegOk,
      },
    },
    200,
    cors,
  );
}

export async function handleZoomAuth(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const state = crypto.randomUUID();
  const authUrl = zoomAuthUrl(env, state);
  return json({ authUrl, state }, 200, cors);
}

export async function handleHistoryGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!historyStorageAvailable(env)) {
    return json({ error: "History storage is not configured." }, 503, cors);
  }
  const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
  const entries = await loadHistory(env, email);
  return json({ email, entries }, 200, cors);
}

export async function handleGeneratePrep(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PrepInput>;
  const companyDomain = normalizeCompanyDomain(String(input.companyDomain || ""));
  if (!companyDomain || !isValidCompanyDomain(companyDomain)) {
    return json({ error: "A valid companyDomain is required (e.g. acme.com)." }, 400, cors);
  }
  if (input.lifecycleId) {
    console.log("generate-prep lifecycleId:", input.lifecycleId);
  }
  if (input.dealId) {
    console.log("generate-prep dealId:", input.dealId);
  }
  const emails = resolveProspectEmails(input as PrepInput);
  if (!emails.length && !input.prospectEmail?.trim()) {
    return json({ error: "At least one valid prospect email is required." }, 400, cors);
  }
  try {
    const result = await generatePrep(env, {
      ...(input as PrepInput),
      companyDomain,
      prospectEmail: emails[0] || String(input.prospectEmail).trim(),
      prospectEmails: emails.length ? emails : undefined,
      prepType: input.prepType || "new_business",
    });
    return json(
      {
        prep: result.prep,
        researchMeta: result.researchMeta,
        researchBundle: result.researchBundle,
        contactDrafts: result.contactDrafts,
      },
      200,
      cors,
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) {
      return json({ error: (err as Error).message }, status, cors);
    }
    throw err;
  }
}

export async function handleContactEnrich(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const body = (await request.json()) as ContactEnrichRequest;
  console.warn(
    `[prep/enrich] ${body.email} linkedinPdf=${body.sources?.linkedinPdf?.fileName || "none"}`,
  );
  try {
    const result = await enrichContact(env, body);
    console.warn(`[prep/enrich] ok ${result.email} name=${result.profile?.name || "unknown"}`);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) {
      return json({ error: (err as Error).message }, status, cors);
    }
    throw err;
  }
}

export async function handlePrepResearch(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PrepInput>;
  const companyDomain = normalizeCompanyDomain(String(input.companyDomain || ""));
  if (!companyDomain || !isValidCompanyDomain(companyDomain)) {
    return json({ error: "A valid companyDomain is required (e.g. acme.com)." }, 400, cors);
  }
  const emails = resolveProspectEmails(input as PrepInput);
  if (!emails.length) {
    return json({ error: "At least one valid prospect email is required." }, 400, cors);
  }
  const result = await runPrepResearch(env, {
    ...(input as PrepInput),
    companyDomain,
    prospectEmail: emails[0],
    prospectEmails: emails,
    prepType: input.prepType || "new_business",
  });
  return json(result, 200, cors);
}

export async function handlePrepSynthesize(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const verified = await requireUser(request, env);
  const input = (await request.json()) as Partial<PrepInput> & {
    confirmedFacts?: unknown[];
    researchBundle?: unknown;
  };
  if (!input.confirmedFacts?.length) {
    return json({ error: "confirmedFacts are required." }, 400, cors);
  }
  const companyDomain = normalizeCompanyDomain(String(input.companyDomain || ""));
  if (!companyDomain || !isValidCompanyDomain(companyDomain)) {
    return json({ error: "A valid companyDomain is required (e.g. acme.com)." }, 400, cors);
  }
  const emails = resolveProspectEmails(input as PrepInput);
  if (!emails.length) {
    return json({ error: "At least one valid prospect email is required." }, 400, cors);
  }
  const result = await runPrepSynthesize(env, {
    ...(input as PrepInput),
    companyDomain,
    prospectEmail: emails[0],
    prospectEmails: emails,
    confirmedFacts: input.confirmedFacts as import("./prep/types").ResearchFact[],
    researchBundle: input.researchBundle as import("./prep/types").ResearchBundle | undefined,
    confirmedProspectProfiles: (input as PrepInput).confirmedProspectProfiles,
  });
  // Option 2 — best-effort pre_call dual-write. Layered on top of the computed
  // brief; never throws to the caller, never changes the 200 (mirrors the
  // post-call /api/history path). Uses the normalized domain we just validated.
  try {
    await tryPrepSynthesizeSqlWrite(
      env,
      verified,
      { ...(input as Record<string, unknown>), companyDomain },
      (result.prep as unknown as Record<string, unknown>) ?? null,
    );
  } catch (err) {
    console.warn(
      "[prep] pre_call dual-write failed (Firestore remains source of truth):",
      err instanceof Error ? err.message : err,
    );
  }
  return json(
    {
      prep: result.prep,
      researchMeta: result.researchMeta,
      researchBundle: result.researchBundle,
      timings: result.timings,
    },
    200,
    cors,
  );
}

export async function handleFetchTranscript(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const body = (await request.json()) as { recordingUrl?: string; recordingPassword?: string };
  if (!body.recordingUrl?.trim()) {
    return json({ error: "recordingUrl is required." }, 400, cors);
  }
  // Returns transcript + optional media stream descriptors (signed mp4 URLs).
  // Does not download video bytes — Pass 2 consumes media from a ffmpeg runtime.
  const result = await fetchRecordingFromShareLink(
    body.recordingUrl.trim(),
    body.recordingPassword?.trim(),
  );
  return json(result, 200, cors);
}

/**
 * Pass 2 — Gemini transcript inference on Workers; ffmpeg sampling on VPS Node (node-server intercepts).
 */
export async function handleVideoPass(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400, cors);
  }

  const callId = typeof body.callId === "string" ? body.callId.trim() : "";
  if (!callId) {
    return json({ ok: false, error: "callId is required." }, 400, cors);
  }

  const { runVideoPass } = await import("./video/pass2");
  const result = await runVideoPass(env, {
    callId,
    media: body.media as import("./zoomShare").ZoomShareMedia | undefined,
    recordingUrl: typeof body.recordingUrl === "string" ? body.recordingUrl : undefined,
    recordingPassword: typeof body.recordingPassword === "string" ? body.recordingPassword : undefined,
    transcript: typeof body.transcript === "string" ? body.transcript : undefined,
    durationSec: typeof body.durationSec === "number" ? body.durationSec : null,
    callType: typeof body.callType === "string" ? body.callType : null,
    visualAnalysisConsent: body.visualAnalysisConsent !== false,
    skipVision: !!body.skipVision,
    seIdentity: typeof body.seIdentity === "string" ? body.seIdentity : null,
    aeIdentity: typeof body.aeIdentity === "string" ? body.aeIdentity : null,
    customerIdentities: Array.isArray(body.customerIdentities)
      ? body.customerIdentities.filter((x): x is string => typeof x === "string")
      : null,
  });

  return json(
    {
      ok: result.ok,
      unavailable: result.unavailable,
      reason: result.reason,
      videoFacts: result.videoFacts,
      pass2Debug: result.pass2Debug,
    },
    200,
    cors,
  );
}

async function kaiaShareJsonFromUrl(
  shareUrl: string,
  cors: Record<string, string>,
): Promise<Response> {
  const result = await fetchKaiaShareContent(shareUrl);
  if (!result.ok) {
    return json(
      { ok: false, reason: result.reason, error: result.message },
      400,
      cors,
    );
  }
  return json(
    {
      ok: true,
      summary: result.summary,
      title: result.title,
      startTime: result.startTime,
      participants: result.participants,
      summaryJson: result.summaryJson,
      bundle: result.bundle,
      transcriptExcerpt: result.transcriptExcerpt,
    },
    200,
    cors,
  );
}

export async function handleKaiaShareContent(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const body = (await request.json()) as { url?: string };
  const shareUrl = body.url?.trim();
  if (!shareUrl) {
    return json({ error: "url is required." }, 400, cors);
  }
  return kaiaShareJsonFromUrl(shareUrl, cors);
}

/** Legacy 2.0.4 contract: { kaiaUrl } → { summary, title, source }. */
export async function handleFetchKaiaSummary(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const body = (await request.json()) as { kaiaUrl?: string; url?: string };
  const shareUrl = body.kaiaUrl?.trim() || body.url?.trim();
  if (!shareUrl) {
    return json({ error: "kaiaUrl is required." }, 400, cors);
  }
  const result = await fetchKaiaShareContent(shareUrl);
  if (!result.ok) {
    const message =
      result.message ||
      (result.reason === "forbidden" || result.reason === "auth_required"
        ? "This Kaia link requires login; use a public share link."
        : "Failed to fetch Kaia summary.");
    return json({ error: message }, 400, cors);
  }
  return json(
    {
      summary: result.summary,
      title: result.title,
    },
    200,
    cors,
  );
}

/**
 * 2026-09-11 staging UAT remediation, item 10 (P1) — server-side dedup for
 * POST /api/postcall/resolve.
 *
 * INVESTIGATION FIRST: runPostCallResolve (src/postcall/resolve.ts) does no
 * Firestore/Postgres write of its own — it is a pure function of its input
 * plus whatever it fetches, so a bare retry cannot corrupt persisted state or
 * produce a WRONG answer. It is not free to repeat, though: when a recording
 * link is present it fetches the Zoom recording (Server-to-Server OAuth /
 * share-link scrape — real API quota) or the Kaia share content, and for a
 * timestamped transcript it makes one Gemini call for speaker attribution
 * (this route hardcodes `attributeSpeakers: true`, see PostCallResolveOptions
 * — real inference cost). A network-level retry of an identical request (a
 * slow connection's fetch timing out and retrying, or a proxy retrying a
 * request whose 200 response was lost after the server had already finished)
 * would pay for that work a second time for an answer already computed.
 *
 * This dedupes by REQUEST CONTENT rather than a client-supplied key, reusing
 * deterministicAppendId (src/data/persistence/idempotency.ts) exactly as-is
 * — same "hash plus a coarse time bucket" reasoning, just a much shorter
 * window, since this is an in-memory guard against a network retry rather
 * than a durable audit-trail id. Content hashing was chosen over adding a
 * client-generated requestId because this route is hit by BOTH the warm-up
 * (runZoomPreResolve) and the real submit path (startPipeline) with
 * genuinely different bodies today, and content hashing dedupes exactly the
 * "same request sent twice" case without touching either call site or the
 * warm-up/submit single-fire behaviour that
 * web/scripts/test-postcall-intake-invariants.mjs already pins down.
 *
 * Deliberately narrow:
 *   - Only a SUCCESSFUL result is cached for reuse. resolveWithZoomPendingRetry
 *     (web/postcall.js) legitimately re-sends the IDENTICAL body several
 *     times, spaced by ZOOM_TRANSCRIPT_POLL_SCHEDULE_MS (30s/120s/300s/900s),
 *     while polling for a Zoom transcript that was still generating — caching
 *     that failure would make every subsequent poll replay the same stale
 *     "still generating" answer instead of actually checking Zoom again. A
 *     failed attempt is evicted from the cache as soon as it settles, so the
 *     next request with matching content (retry or a real subsequent poll)
 *     always starts a fresh attempt.
 *   - Two literally concurrent identical requests (the in-flight case — e.g.
 *     a slow connection where the client's own fetch is still pending when a
 *     retry fires) share the SAME in-flight promise instead of issuing a
 *     second Zoom/Gemini call.
 */
/** Exported so tests can compute bucket boundaries without duplicating the constant. */
export const RESOLVE_DEDUP_WINDOW_MS = 30_000;

interface ResolveDedupEntry {
  promise: Promise<PostCallResolveResult>;
  /** Entries are pruned once their content-hash time bucket has rolled over. */
  bucketExpiresAt: number;
}

const resolveDedupCache = new Map<string, ResolveDedupEntry>();

/** Drops entries whose dedup window has already elapsed, so the map stays bounded. */
function pruneResolveDedupCache(now: number): void {
  for (const [key, entry] of resolveDedupCache) {
    if (entry.bucketExpiresAt <= now) resolveDedupCache.delete(key);
  }
}

/**
 * Dedup wrapper around runPostCallResolve — see the block comment above for
 * why this exists and what it deliberately does not cache. `run` and `now`
 * are injectable so tests can drive this without a real Zoom/Gemini call.
 * Exported for tests only.
 */
export async function runPostCallResolveDeduped(
  input: Partial<PostCallResolveInput> & { email?: string },
  resolveOptions: PostCallResolveOptions,
  dedup: {
    now?: number;
    run?: (
      input: PostCallResolveInput,
      options: PostCallResolveOptions,
    ) => Promise<PostCallResolveResult>;
  } = {},
): Promise<PostCallResolveResult> {
  const now = dedup.now ?? Date.now();
  const run = dedup.run ?? runPostCallResolve;
  pruneResolveDedupCache(now);

  const key = deterministicAppendId(
    "postcall_resolve",
    "req",
    input as unknown as Record<string, unknown>,
    now,
    RESOLVE_DEDUP_WINDOW_MS,
  );
  const existing = resolveDedupCache.get(key);
  if (existing) return existing.promise;

  const promise = run(input as PostCallResolveInput, resolveOptions);
  const bucketExpiresAt = (Math.floor(now / RESOLVE_DEDUP_WINDOW_MS) + 1) * RESOLVE_DEDUP_WINDOW_MS;
  const entry: ResolveDedupEntry = { promise, bucketExpiresAt };
  resolveDedupCache.set(key, entry);
  // A failed attempt must never be replayed — see "Deliberately narrow" above.
  promise.catch(() => {
    if (resolveDedupCache.get(key) === entry) resolveDedupCache.delete(key);
  });
  return promise;
}

/** Test seam — clears the module-level resolve dedup cache. */
export function __resetResolveDedupCacheForTests(): void {
  resolveDedupCache.clear();
}

export async function handlePostCallResolve(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallResolveInput> & { email?: string };
  await assertManagerProxyOwnerEmail(request, env, input.ownerEmail, input.email || input.ownerEmail);
  if (!input.transcript?.trim() && !input.recordingUrl?.trim()) {
    return json(
      { error: "Paste a transcript or a Zoom/Kaia recording link (with passcode if needed)." },
      400,
      cors,
    );
  }
  try {
    const result = await runPostCallResolveDeduped(input, {
      zoomEnv: env,
      providerEnv: env,
      // Only this interactive confirm-page flow ever shows the speaker-attribution
      // suggestion to a human — see PostCallResolveOptions.attributeSpeakers.
      attributeSpeakers: true,
    });
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) {
      // Zoom transcript-still-generating (astra-audit F-026/E-107) is a distinct,
      // retryable outcome, not a hard "give up and paste the transcript" failure --
      // surface it explicitly so the browser can poll instead of showing a dead end.
      const pending = (err as { pending?: boolean }).pending === true;
      const meetingStartTime = (err as { meetingStartTime?: string }).meetingStartTime;
      return json(
        {
          error: (err as Error).message,
          ...(pending ? { zoomTranscriptPending: true, meetingStartTime } : {}),
        },
        status,
        cors,
      );
    }
    throw err;
  }
}

export async function handlePostCallClassify(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallClassifyInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallClassify(env, input as PostCallClassifyInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

export async function handlePostCallGenerate(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<
    PostCallGenerateInput &
      PostCallResolveInput & {
        resolveSnapshot?: unknown;
        classifySnapshot?: unknown;
        videoFacts?: unknown;
      }
  >;
  if (!input.transcript?.trim() && !input.recordingUrl?.trim()) {
    return json(
      { error: "transcript or recordingUrl is required after confirmation." },
      400,
      cors,
    );
  }
  if (!input.callType) {
    return json({ error: "callType is required after confirmation." }, 400, cors);
  }
  if (input.lifecycleId) console.log("postcall/generate lifecycleId:", input.lifecycleId);
  if (input.dealId) console.log("postcall/generate dealId:", input.dealId);
  try {
    const result = await runPostCallConfirmedPipeline(
      env,
      input as PostCallGenerateInput & PostCallResolveInput & { videoFacts?: import("./domain-model/video-facts").VideoFactsDraft },
    );
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** Pass 7 — commitments, call notes, MoM draft. Never auto-sends MoM. */
export async function handlePostCallSummarise(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallSummariseInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallSummarise(env, input as PostCallSummariseInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** Pass 4 — MEDDPICC qualification (deal intelligence). */
export async function handlePostCallQualify(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallQualifyInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallQualify(env, input as PostCallQualifyInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** Pass 5 — Technical commit snapshot + per-call deltas. */
export async function handlePostCallCommit(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallCommitInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallCommit(env, input as PostCallCommitInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** ARR compute from extracted inputs — pure function only (task 2.5b). */
export async function handlePostCallArrCompute(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallArrComputeInput>;
  try {
    const result = runPostCallArrCompute(input as PostCallArrComputeInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** ARR input extraction — inputs only, no arithmetic (spec §7.5). */
export async function handlePostCallArrInputs(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallArrInputsInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallArrInputs(env, input as PostCallArrInputsInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** Pass 6 — product gaps + what landed (spec §8). */
export async function handlePostCallGaps(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallGapsInput>;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  try {
    const result = await runPostCallGaps(env, input as PostCallGapsInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/**
 * Call timeline — phase spine + markers from the transcript clock (spec §11.4).
 * Deterministic, no model call. Display evidence only; never touches a score.
 */
export async function handlePostCallTimeline(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as {
    transcript?: string;
  } & TimelineMarkerSources;
  if (!input.transcript?.trim()) {
    return json({ error: "transcript is required." }, 400, cors);
  }
  const result = deriveCallTimeline(input.transcript, {
    gaps: input.gaps,
    whatWorks: input.whatWorks,
    objections: input.objections,
    scorecardLines: input.scorecardLines,
  });
  return json(result, 200, cors);
}

/** Async gap clustering over verbatim embeddings (ADR-006). PM/admin trigger. */
export async function handleProductSignalCluster(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<RunClusteringInput>;
  if (!input.orgId?.trim()) {
    return json({ error: "orgId is required." }, 400, cors);
  }
  if (!Array.isArray(input.gaps)) {
    return json({ error: "gaps array is required." }, 400, cors);
  }
  try {
    const result = await runGapClustering(env, {
      orgId: input.orgId.trim(),
      gaps: input.gaps,
      clusters: Array.isArray(input.clusters) ? input.clusters : [],
      mode: input.mode,
      pendingGapCount: input.pendingGapCount,
      lastFullRunAt: input.lastFullRunAt,
      lastIncrementalAt: input.lastIncrementalAt,
      suggestLabels: input.suggestLabels,
    });
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

/** Pass 9 — deal + account summaries (evidence-grounded roll-ups). */
export async function handlePostCallSummaries(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallSummariesInput>;
  if (!input.account?.accountId) {
    return json({ error: "account context is required." }, 400, cors);
  }
  try {
    const result = await runPostCallSummaries(env, input as PostCallSummariesInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

export async function handleAnalyzeCall(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const verified = await requireUser(request, env);
  const input = (await request.json()) as Partial<
    PostCallGenerateInput & PostCallResolveInput & { confirmed?: boolean }
  >;
  // P9/J-019: cost attribution must come from the VERIFIED session, never the
  // request body. PostCallClassifyInput.userId is documented "set by route
  // handlers", but this handler previously discarded requireUser's result and
  // let input.userId through as the client sent it. Two consequences:
  // ai_run.user_id was NULL whenever the client omitted it (16.5% coverage),
  // and a caller could attribute its own token spend to another user by
  // setting the field — the same "client-supplied value trusted as authority"
  // shape as J-025. In dummy-auth mode requireUser returns null by design, so
  // the client value is all there is; the boot guard in node-server.ts already
  // hard-fails that mode under NODE_ENV=production.
  stampVerifiedUsageIdentity(input, verified);
  if (!input.transcript?.trim() && !input.recordingUrl?.trim()) {
    return json(
      { error: "Paste a transcript or a Zoom recording link (with passcode if needed)." },
      400,
      cors,
    );
  }
  if (input.lifecycleId) {
    console.log("analyze-call lifecycleId:", input.lifecycleId);
  }
  if (input.dealId) {
    console.log("analyze-call dealId:", input.dealId);
  }
  try {
    if (input.confirmed && input.callType) {
      const result = await runPostCallConfirmedPipeline(env, input as PostCallGenerateInput & PostCallResolveInput);
      return json(result, 200, cors);
    }
    const result = await runPostCallLegacyAnalyze(env, input as PostCallGenerateInput & PostCallResolveInput);
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}

export async function handleTasksGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!tasksStorageAvailable(env)) {
    return json({ error: "Task storage is not configured." }, 503, cors);
  }
  const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
  const tasks = await loadTasks(env, email);
  return json({ email, tasks }, 200, cors);
}

export async function handleTaskPatch(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  taskId: string,
): Promise<Response> {
  if (!tasksStorageAvailable(env)) {
    return json({ error: "Task storage is not configured." }, 503, cors);
  }
  const body = (await request.json()) as Partial<Task> & { email?: string };
  const email = await resolveHistoryEmail(request, env, body.email || "");
  const task = await patchTask(env, email, taskId, body);
  if (!task) return json({ error: "Task not found." }, 404, cors);
  return json({ email, task }, 200, cors);
}

export async function handleTaskDelete(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  taskId: string,
): Promise<Response> {
  if (!tasksStorageAvailable(env)) {
    return json({ error: "Task storage is not configured." }, 503, cors);
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = await resolveHistoryEmail(
    request,
    env,
    body.email || url.searchParams.get("email") || "",
  );
  const ok = await deleteTask(env, email, taskId);
  if (!ok) return json({ error: "Task not found." }, 404, cors);
  return json({ email, deleted: taskId }, 200, cors);
}

export async function handleTasksPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!tasksStorageAvailable(env)) {
    return json({ error: "Task storage is not configured." }, 503, cors);
  }
  const body = (await request.json()) as {
    email?: string;
    task?: Task;
    tasks?: Task[];
  };
  const email = await resolveHistoryEmail(request, env, body.email || "");

  if (Array.isArray(body.tasks)) {
    const tasks = await saveTasks(env, email, body.tasks);
    return json({ email, tasks, count: tasks.length }, 200, cors);
  }

  if (!body.task?.id || !body.task.title) {
    return json({ error: "task with id and title is required." }, 400, cors);
  }
  const tasks = await upsertTask(env, email, body.task);
  return json({ email, task: body.task, count: tasks.length }, 200, cors);
}

export async function handleFeedbackGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!feedbackStorageAvailable(env)) {
    return json({ error: "Feedback storage is not configured." }, 503, cors);
  }
  const global = url.searchParams.get("global") === "1";
  if (global) {
    // astra-audit F-010: this branch returned BEFORE the only auth call in the
    // function (resolveHistoryEmail, below), so GET /api/feedback?global=1
    // served every user's feedback — including submitter email and message
    // text — to a completely unauthenticated caller. The per-IP rate-limit
    // bucket was the only thing in front of it, and a bucket is not identity.
    //
    // Authentication alone is not enough here: the branch exists to read ACROSS
    // users, so any signed-in SE would still be over-served. Admin only.
    const verified = await requireUser(request, env);
    if (!verified) {
      return json({ error: "Sign-in required." }, 401, cors);
    }
    const ctx = await resolveRequestContext(verified, env);
    if (ctx.role !== "admin") {
      return json({ error: "Admin scope required." }, 403, cors);
    }
    const entries = await loadGlobalFeedback(env);
    return json({ entries, count: entries.length }, 200, cors);
  }
  const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
  const entries = await loadFeedback(env, email);
  return json({ email, entries, count: entries.length }, 200, cors);
}

export async function handleFeedbackPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!feedbackStorageAvailable(env)) {
    return json({ error: "Feedback storage is not configured." }, 503, cors);
  }
  const body = (await request.json()) as {
    email?: string;
    entry?: Partial<FeedbackEntry> & { body?: string };
    message?: string;
    body?: string;
    category?: string;
    id?: string;
    page?: string;
    createdAt?: number;
    severity?: string;
    area?: string;
    priority?: string;
    context?: FeedbackEntry["context"];
    attachmentBase64?: string;
    attachmentFilename?: string;
    attachmentContentType?: string;
  };
  const email = await resolveHistoryEmail(request, env, body.email || body.entry?.email || "");
  const nested = body.entry || {};
  const message = String(nested.message || nested.body || body.message || body.body || "").trim();
  if (!message) {
    return json({ error: "entry.message is required." }, 400, cors);
  }
  const entry: FeedbackEntry = {
    id: nested.id || body.id || crypto.randomUUID(),
    category: normalizeFeedbackCategory(String(nested.category || body.category || "Idea")),
    message: message.slice(0, 4000),
    page: nested.page || body.page,
    email,
    createdAt: nested.createdAt || body.createdAt || Date.now(),
    severity: nested.severity || body.severity,
    area: nested.area || body.area,
    priority: nested.priority || body.priority,
    context: nested.context || body.context,
  };
  let attachment: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
  if (body.attachmentBase64) {
    try {
      const decoded = attachmentFromBase64(
        body.attachmentBase64,
        body.attachmentFilename || "screenshot.png",
        body.attachmentContentType || "application/octet-stream",
      );
      if (decoded) {
        if (decoded.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          return json(
            {
              error: `Attachment too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB).`,
            },
            400,
            cors,
          );
        }
        attachment = decoded;
      }
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      return json({ error: (err as Error).message || "Invalid attachment." }, status, cors);
    }
  }
  const entries = await appendFeedback(env, email, entry, attachment);
  console.info(
    `[feedback] ${entry.category} from ${email}: ${entry.message.slice(0, 80)}${entry.message.length > 80 ? "…" : ""}`,
  );
  return json({
    email,
    entry,
    count: entries.length,
    ticketId: entry.ticketId ?? null,
    ticketError: entry.ticketError ?? null,
  }, 200, cors);
}

/**
 * POST /api/disputes/notify — soft-fail manager email after a score dispute is logged.
 * Returns { sent, via } even when notify is disabled (never blocks dispute logging).
 */
export async function handleDisputeNotifyPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  let body: {
    email?: string;
    to?: string;
    toName?: string;
    seName?: string;
    callTitle?: string;
    category?: string;
    note?: string;
    link?: string;
    via?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400, cors);
  }

  // Auth shape mirrors feedback: Firebase token when configured; else demo email in body.
  await resolveHistoryEmail(request, env, body.email || "");

  const to = String(body.to || "")
    .trim()
    .toLowerCase();
  if (!to || !to.includes("@")) {
    return json({ error: "to (manager email) is required." }, 400, cors);
  }

  const result = await sendManagerDisputeEmail(env, {
    to,
    toName: body.toName,
    seName: body.seName,
    callTitle: body.callTitle,
    category: body.category,
    note: body.note,
    link: body.link,
  });

  return json(
    {
      sent: result.sent,
      // Prefer client org-resolution via (line_manager|…) for audit; fall back to provider id.
      via: body.via || result.via || null,
      ...(result.error ? { error: result.error } : {}),
    },
    200,
    cors,
  );
}

type TicketFormFields = {
  kindRaw: string;
  description: string;
  subject: string;
  category: string;
  emailFallback: string;
  name: string;
  callId: string;
  company: string;
  themeKey: string;
  score: string;
  grade: string;
  page: string;
  link: string;
  attachment: File | null;
  attachmentBase64: string;
  attachmentFilename: string;
  attachmentContentType: string;
};

function parseTicketKind(raw: string): FreshdeskTicketKind | null {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (k === "dispute_score" || k === "dispute_of_score" || k === "dispute") return "dispute_score";
  if (k === "feedback") return "feedback";
  return null;
}

async function readTicketPayload(request: Request): Promise<TicketFormFields> {
  const emptyAttach = {
    attachment: null as File | null,
    attachmentBase64: "",
    attachmentFilename: "",
    attachmentContentType: "",
  };
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const file = form.get("attachment");
    const upload =
      file && typeof file !== "string" && typeof (file as Blob).arrayBuffer === "function" && (file as Blob).size > 0
        ? (file as File)
        : null;
    return {
      kindRaw: get("kind"),
      description: get("description") || get("note") || get("message"),
      subject: get("subject"),
      category: get("category"),
      emailFallback: get("email"),
      name: get("name"),
      callId: get("callId") || get("call_id"),
      company: get("company"),
      themeKey: get("themeKey") || get("theme_key"),
      score: get("score"),
      grade: get("grade"),
      page: get("page"),
      link: get("link"),
      attachment: upload,
      attachmentBase64: get("attachmentBase64"),
      attachmentFilename: get("attachmentFilename"),
      attachmentContentType: get("attachmentContentType"),
    };
  }

  const body = (await request.json()) as Record<string, unknown>;
  const str = (key: string) => String(body[key] ?? "").trim();
  return {
    kindRaw: str("kind"),
    description: str("description") || str("note") || str("message"),
    subject: str("subject"),
    category: str("category"),
    emailFallback: str("email"),
    name: str("name"),
    callId: str("callId") || str("call_id"),
    company: str("company"),
    themeKey: str("themeKey") || str("theme_key"),
    score: str("score"),
    grade: str("grade"),
    page: str("page"),
    link: str("link"),
    ...emptyAttach,
    attachmentBase64: str("attachmentBase64"),
    attachmentFilename: str("attachmentFilename") || "screenshot.png",
    attachmentContentType: str("attachmentContentType") || "application/octet-stream",
  };
}

function attachmentFromBase64(
  base64: string,
  filename: string,
  contentType: string,
): { filename: string; contentType: string; bytes: Uint8Array } | null {
  const raw = String(base64 || "").trim();
  if (!raw) return null;
  try {
    const bin = atob(raw.replace(/^data:[^;]+;base64,/, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!bytes.byteLength) return null;
    return {
      filename: filename || "screenshot.png",
      contentType: contentType || "application/octet-stream",
      bytes,
    };
  } catch {
    throw Object.assign(new Error("Invalid attachment encoding."), { status: 400 });
  }
}

/**
 * POST /api/tickets — create a Freshdesk ticket (dispute score or product feedback).
 * Accepts JSON or multipart/form-data (optional screenshot as `attachment`).
 * Requester email = verified Firebase user when auth is on; else body.email (demo).
 */
export async function handleTicketsPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!freshdeskConfigured(env)) {
    return json(
      { error: "Freshdesk is not configured (missing FRESHDESK_API_KEY)." },
      503,
      cors,
    );
  }

  let fields: TicketFormFields;
  try {
    fields = await readTicketPayload(request);
  } catch {
    return json({ error: "Invalid request body." }, 400, cors);
  }

  const kind = parseTicketKind(fields.kindRaw);
  if (!kind) {
    return json({ error: 'kind must be "dispute_score" or "feedback".' }, 400, cors);
  }

  const descriptionText = String(fields.description || "").trim();
  if (!descriptionText) {
    return json({ error: "description is required." }, 400, cors);
  }

  let email: string;
  try {
    email = await resolveHistoryEmail(request, env, fields.emailFallback || "");
  } catch (err) {
    const status = (err as { status?: number }).status || 401;
    return json({ error: (err as Error).message || "Sign-in required." }, status, cors);
  }

  const category =
    kind === "feedback"
      ? normalizeFeedbackCategory(fields.category || "Idea")
      : String(fields.category || "").trim();

  const issueType =
    kind === "dispute_score" ? mapDisputeIssueType(category) || category || null : null;

  const subject =
    fields.subject ||
    defaultSubjectForKind(kind, kind === "feedback" ? String(category) : undefined);

  const ticketTypeLabel = ticketTypeForKind(kind);
  const meta: Array<string | null> = [
    `Ticket type: ${ticketTypeLabel}`,
    issueType ? `Issue type: ${issueType}` : category ? `Category: ${category}` : null,
    fields.company ? `Company: ${fields.company}` : null,
    fields.callId ? `Call ID: ${fields.callId}` : null,
    fields.themeKey ? `Theme: ${fields.themeKey.replace(/_/g, " ")}` : null,
    fields.grade ? `Theme grade: ${fields.grade}/10` : null,
    fields.score ? `Score: ${fields.score}` : null,
    fields.page ? `Page: ${fields.page}` : null,
    fields.link ? `Link: ${fields.link}` : null,
    `Submitted by: ${email}`,
  ];

  const customFields = buildTicketCustomFields(kind, {
    category: kind === "dispute_score" ? category : undefined,
    callId: fields.callId,
    page: fields.page || fields.link,
  });

  let attachment: { filename: string; contentType: string; bytes: ArrayBuffer | Uint8Array } | null =
    null;
  if (fields.attachment) {
    if (fields.attachment.size > MAX_ATTACHMENT_BYTES) {
      return json(
        {
          error: `Attachment too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB).`,
        },
        400,
        cors,
      );
    }
    const bytes = await fields.attachment.arrayBuffer();
    const filename = fields.attachment.name || "screenshot.png";
    const contentType = fields.attachment.type || "application/octet-stream";
    attachment = { filename, contentType, bytes };
  } else if (fields.attachmentBase64) {
    try {
      const decoded = attachmentFromBase64(
        fields.attachmentBase64,
        fields.attachmentFilename,
        fields.attachmentContentType,
      );
      if (decoded) {
        if (decoded.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          return json(
            {
              error: `Attachment too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB).`,
            },
            400,
            cors,
          );
        }
        attachment = decoded;
      }
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      return json({ error: (err as Error).message || "Invalid attachment." }, status, cors);
    }
  }

  console.info(
    `[tickets] creating ${kind} for ${email}${attachment ? ` (+attachment ${attachment.filename})` : ""}`,
  );

  try {
    const ticket = await createFreshdeskTicket(env, {
      email,
      name: fields.name || undefined,
      subject,
      description: buildTicketDescriptionHtml(descriptionText, meta),
      type: ticketTypeLabel,
      tags: ["lionpath", kind === "dispute_score" ? "dispute-score" : "feedback"],
      customFields,
      attachment,
    });

    return json(
      {
        ok: true,
        ticketId: ticket.id,
        subject: ticket.subject,
        type: ticket.type,
        issueType: issueType || null,
        email,
        kind,
      },
      201,
      cors,
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 502;
    return json({ error: (err as Error).message || "Failed to create ticket." }, status, cors);
  }
}

export async function handleHistoryPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!historyStorageAvailable(env)) {
    return json({ error: "History storage is not configured." }, 503, cors);
  }
  const body = (await request.json()) as {
    email?: string;
    targetEmail?: string;
    proxySeActing?: boolean;
    entry?: HistoryEntry;
    entries?: HistoryEntry[];
  };
  const email = await resolveHistoryEmailForWrite(request, env, body);

  if (Array.isArray(body.entries)) {
    const entries = await replaceHistory(env, email, body.entries);
    return json({ email, entries, count: entries.length }, 200, cors);
  }

  if (!body.entry?.id || typeof body.entry.timestamp !== "number") {
    return json({ error: "entry with id and timestamp is required." }, 400, cors);
  }
  const entries = await saveHistoryEntry(env, email, body.entry);
  // Option 2 — best-effort Postgres dual-write. The history blob write above is
  // the primary, user-facing persistence path; a PG failure must NEVER change
  // the 200 we return here, so the entire dual-write is wrapped + logged and
  // never re-thrown. resolveHistoryEmailForWrite already verified the token;
  // we re-resolve the user here only to obtain the owning identity.
  try {
    const verified = await requireUser(request, env);
    await tryHistoryPostCallSqlWrite(env, verified, body.entry);
  } catch (err) {
    // Best-effort contract: never change the 200, never rethrow. But a failure
    // here means a post_call did NOT reach Postgres while the Firestore blob
    // DID — a real dual-write divergence, not a benign skip. Log LOUD (error)
    // with a stable tag + the entry id so it is greppable, alertable, and
    // replayable, instead of the old whisper-level "skipped" warn.
    console.error(
      `[history][dual-write-DROPPED] post_call ${body.entry?.id ?? "?"} NOT persisted to Postgres (Firestore blob OK):`,
      err instanceof Error ? err.stack || err.message : err,
    );
    // astra-audit P5: the loud console line above is not queryable — you cannot
    // ask "which calls silently failed to persist last week" from stdout. Record
    // a row so the failure is attributable to a request, an actor and an entity.
    // The message goes in detail; the stack stays in the server log only.
    logFallback(
      {
        method: "historyPostCallDualWrite",
        reason: "write_error",
        detail: err instanceof Error ? err.message : String(err),
        entityPublicId: body.entry?.id ?? null,
      },
      env,
    );
    // The previous implementation returned the full stack trace to the client in
    // a `_sqlDualWriteError` response field, labelled TEMP DEBUG pending the
    // 2026-09-08 investigation. Removed: a stack trace in an API response is
    // exactly the sensitive payload P5 says must not be exposed, and it had no
    // consumer anywhere in web/ or worker/ — verified by a repo-wide search.
    // The queryable row above replaces it.
  }
  return json(
    { email, entry: body.entry, count: entries.length },
    200,
    cors,
  );
}

/** POST /api/search/rag — embedding rerank for portal omni-search. */
/**
 * Per-request cost ceilings for /api/search/rag (astra-audit F-011). Embedding
 * spend scales with candidate count and text length, both caller-controlled.
 * Generous enough not to affect real product traffic, small enough that a single
 * request cannot burn a meaningful amount of the provider budget.
 */
const RAG_MAX_CANDIDATES = 200;
const RAG_MAX_QUERY_CHARS = 4000;

export async function handleSearchRag(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  // astra-audit F-011: this handler had NO auth call of any kind — the first
  // statement was the body parse. An unauthenticated caller could drive
  // rerankWithEmbeddings() on the server's own provider credentials: denial of
  // wallet, with no identity to attribute or rate-limit the spend against.
  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  const body = (await request.json()) as { query?: string; candidates?: RagCandidate[] };
  const query = String(body.query || "").trim();
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (!query) {
    return json({ error: "query is required." }, 400, cors);
  }
  // Authentication bounds WHO can spend; these bound HOW MUCH a single request
  // can spend. Embedding cost scales with the candidate count and the text
  // length, both of which are caller-controlled, so an authenticated user could
  // otherwise post one enormous request per rate-limit window.
  if (query.length > RAG_MAX_QUERY_CHARS) {
    return json({ error: `query exceeds ${RAG_MAX_QUERY_CHARS} characters.` }, 413, cors);
  }
  if (candidates.length > RAG_MAX_CANDIDATES) {
    return json({ error: `candidates exceeds ${RAG_MAX_CANDIDATES} entries.` }, 413, cors);
  }
  const ranked = await rerankWithEmbeddings(env, query, candidates);
  return json({ query, ranked, rag: ranked.length > 0 }, 200, cors);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStringField(value: unknown): string | null {
  const s = stringField(value);
  return s || null;
}

function stripUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripUndefined).filter((v) => v !== undefined);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = stripUndefined(child);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function dealContactId(dealId: unknown, contactId: unknown): string {
  return `${String(dealId || "").trim()}_${String(contactId || "").trim()}`;
}

async function setDomainDoc(
  env: Env,
  col: string,
  docData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await getDb(env);
  const ref = docData.id ? db.collection(col).doc(String(docData.id)) : db.collection(col).doc();
  const data = stripUndefined({ ...docData, id: ref.id }) as Record<string, unknown>;
  await ref.set(data, { merge: true });
  return data;
}

async function updateDomainDoc(
  env: Env,
  col: string,
  id: unknown,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const db = await getDb(env);
  const key = String(id || "").trim();
  if (!key) return null;
  const ref = db.collection(col).doc(key);
  await ref.set(stripUndefined({ ...patch, updatedAt: patch.updatedAt || Date.now() }) as Record<string, unknown>, {
    merge: true,
  });
  const snap = await ref.get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as Record<string, unknown>) : null;
}

async function deleteDomainDoc(env: Env, col: string, id: unknown): Promise<boolean> {
  const key = String(id || "").trim();
  if (!key) return false;
  const db = await getDb(env);
  await db.collection(col).doc(key).delete();
  return true;
}

async function deleteWhere(env: Env, col: string, field: string, value: unknown): Promise<number> {
  const key = String(value || "").trim();
  if (!key) return 0;
  const db = await getDb(env);
  const snap = await db.collection(col).where(field, "==", key).get();
  const batch = db.batch();
  snap.docs.forEach((docSnap: any) => batch.delete(docSnap.ref));
  if (!snap.empty) await batch.commit();
  return snap.size;
}

const UPSERT_COLLECTIONS: Record<string, string> = {
  upsertPostCall: "postCalls",
  upsertCallSummary: "callSummaries",
  upsertScorecard: "scorecards",
  upsertScorecardLine: "scorecardLines",
  upsertVideoFacts: "videoFacts",
  upsertTimelineSegment: "timelineSegments",
  upsertTimelineMarker: "timelineMarkers",
  upsertFollowUp: "followUps",
  upsertObjection: "objections",
  upsertMomDraft: "momDrafts",
  upsertMeddpiccDelta: "meddpiccDeltas",
  upsertDealSignal: "dealSignals",
  upsertArrLine: "arrLines",
  upsertTcDelta: "tcDeltas",
  upsertTechnicalCommit: "technicalCommits",
  upsertArrOverride: "arrOverrides",
  upsertProductGap: "productGaps",
  upsertWhatWorks: "whatWorks",
  upsertGapCluster: "gapClusters",
  upsertClusteringState: "clusteringStates",
};

const DELETE_COLLECTIONS: Record<string, string> = {
  deleteTask: "tasks",
  deleteScorecard: "scorecards",
  deleteVideoFacts: "videoFacts",
  deleteFollowUp: "followUps",
  deleteObjection: "objections",
  deleteMomDraft: "momDrafts",
  deleteMeddpiccDelta: "meddpiccDeltas",
  deleteDealSignal: "dealSignals",
  deleteArrLine: "arrLines",
  deleteTcDelta: "tcDeltas",
};

async function applyDomainWrite(
  env: Env,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (UPSERT_COLLECTIONS[method]) {
    return setDomainDoc(env, UPSERT_COLLECTIONS[method], (args[0] || {}) as Record<string, unknown>);
  }
  if (DELETE_COLLECTIONS[method]) {
    return deleteDomainDoc(env, DELETE_COLLECTIONS[method], args[0]);
  }

  switch (method) {
    case "createAccount":
      return setDomainDoc(env, "accounts", (args[0] || {}) as Record<string, unknown>);
    case "updateAccount":
      return updateDomainDoc(env, "accounts", args[0], (args[1] || {}) as Record<string, unknown>);
    case "createContact":
      return setDomainDoc(env, "contacts", (args[0] || {}) as Record<string, unknown>);
    case "updateContact":
      return updateDomainDoc(env, "contacts", args[0], (args[1] || {}) as Record<string, unknown>);
    case "createDeal":
      return setDomainDoc(env, "deals", (args[0] || {}) as Record<string, unknown>);
    case "updateDeal":
      return updateDomainDoc(env, "deals", args[0], (args[1] || {}) as Record<string, unknown>);
    case "createLifecycle":
      return setDomainDoc(env, "lifecycles", (args[0] || {}) as Record<string, unknown>);
    case "updateLifecycle":
      return updateDomainDoc(env, "lifecycles", args[0], (args[1] || {}) as Record<string, unknown>);
    case "addLifecycleEvent":
      return setDomainDoc(env, "lifecycleEvents", (args[0] || {}) as Record<string, unknown>);
    case "createPrepBrief":
      return setDomainDoc(env, "prepBriefs", (args[0] || {}) as Record<string, unknown>);
    case "createTask":
      return setDomainDoc(env, "tasks", (args[0] || {}) as Record<string, unknown>);
    case "updateTask":
      return updateDomainDoc(env, "tasks", args[0], (args[1] || {}) as Record<string, unknown>);
    case "addContactEvent": {
      const event = (args[0] || {}) as Record<string, unknown>;
      const contactId = stringField(event.contactId);
      if (!contactId) return null;
      const db = await getDb(env);
      const ref = event.id
        ? db.collection("contacts").doc(contactId).collection("events").doc(String(event.id))
        : db.collection("contacts").doc(contactId).collection("events").doc();
      const data = stripUndefined({ ...event, id: ref.id }) as Record<string, unknown>;
      await ref.set(data, { merge: true });
      return data;
    }
    case "createDealContact": {
      const link = (args[0] || {}) as Record<string, unknown>;
      const id = dealContactId(link.dealId, link.contactId);
      return setDomainDoc(env, "dealContacts", { ...link, id });
    }
    case "setPrimaryDealContact": {
      const dealId = stringField(args[0]);
      const contactId = stringField(args[1]);
      if (!dealId || !contactId) return null;
      const db = await getDb(env);
      const snap = await db.collection("dealContacts").where("dealId", "==", dealId).get();
      const batch = db.batch();
      let promoted: Record<string, unknown> | null = null;
      snap.docs.forEach((docSnap: any) => {
        const row = { id: docSnap.id, ...docSnap.data() };
        const isPrimary = row.contactId === contactId;
        if (isPrimary) promoted = { ...row, isPrimary: true };
        batch.set(docSnap.ref, { isPrimary, updatedAt: Date.now() }, { merge: true });
      });
      if (!snap.empty) await batch.commit();
      return promoted;
    }
    case "removeDealContact":
      return deleteDomainDoc(env, "dealContacts", dealContactId(args[0], args[1]));
    case "upsertPostCallWithSummary": {
      const postCall = (args[0] || {}) as Record<string, unknown>;
      const callSummary = args[1] as Record<string, unknown> | null;
      const db = await getDb(env);
      const postRef = postCall.id
        ? db.collection("postCalls").doc(String(postCall.id))
        : db.collection("postCalls").doc();
      const postData = stripUndefined({ ...postCall, id: postRef.id }) as Record<string, unknown>;
      const batch = db.batch();
      batch.set(postRef, postData, { merge: true });
      if (callSummary) {
        const sumRef = db.collection("callSummaries").doc(String(callSummary.id || postRef.id));
        batch.set(sumRef, stripUndefined({ ...callSummary, id: sumRef.id }) as Record<string, unknown>, {
          merge: true,
        });
      }
      await batch.commit();
      return postData;
    }
    case "deleteScorecardLinesByScorecardId":
      return deleteWhere(env, "scorecardLines", "scorecardId", args[0]);
    case "deleteTimelineSegmentsByVideoFactsId":
      return deleteWhere(env, "timelineSegments", "videoFactsId", args[0]);
    case "deleteTranscriptTimelineByCall": {
      const segments = await deleteWhere(env, "timelineSegments", "callId", args[0]);
      const markers = await deleteWhere(env, "timelineMarkers", "callId", args[0]);
      return segments + markers;
    }
    default:
      throw Object.assign(new Error(`Unsupported domain write method: ${method}`), { status: 400 });
  }
}

/** POST /api/domain-write — authenticated Admin SDK write transport for browser domain store. */
export async function handleDomainWrite(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const mode = (env.PERSISTENCE_MODE || "").trim();
  // QA #15: pure sql mode must not require Firestore admin. dual mode still
  // needs it (outbox projects to Firestore); firestore mode obviously does.
  if (mode !== "sql" && !firestoreAdminReady(env)) {
    return json({ error: "Firestore admin is not configured for domain writes." }, 503, cors);
  }
  const verified = await requireUser(request, env);
  const body = (await request.json()) as { method?: string; args?: unknown[] };
  const method = stringField(body.method);
  if (!method) return json({ error: "method is required." }, 400, cors);
  const args = Array.isArray(body.args) ? body.args : [];

  // SQL-primary path (dual/sql mode): CRM writes go to Postgres inside an
  // RLS-scoped transaction; Firestore is projected via sync_outbox.
  const sqlResult = await trySqlDomainWrite(env, verified, method, args, request);
  if (sqlResult.handled) {
    return json({ result: sqlResult.result }, 200, cors);
  }

  // THE MODE GUARD.
  //
  // Without this, an unhandled method fell through to applyDomainWrite and
  // wrote to Firestore -- in EVERY mode, including sql. So "Postgres only" was
  // not true: any method without a SQL path silently kept using Firestore, and
  // nothing surfaced it.
  //
  // In sql mode there is no Firestore write target, so a gap must be an ERROR.
  // 501 and not 500: the request was valid, the server has no implementation
  // for it yet. The client sees a real failure instead of a false success, and
  // the fallback log already recorded the method and reason.
  if (mode === "sql") {
    console.error(
      `[sql-mode] ${method} has no Postgres write path — REFUSED. ` +
        `Firestore is not a write target in sql mode, so falling through would ` +
        `silently resurrect it. Wire the method or switch to dual.`,
    );
    return json(
      {
        error: `No Postgres write path for "${method}".`,
        detail:
          "PERSISTENCE_MODE=sql, so this write cannot fall back to Firestore. " +
          "See janus/scripts/coverage-report.mjs for every method in this state.",
        method,
      },
      501,
      cors,
    );
  }

  const result = await applyDomainWrite(env, method, args);
  return json({ result }, 200, cors);
}

function canWriteUnscopedResource(
  ctx: RequestContext | null,
  operation: "create" | "update",
): boolean {
  if (!ctx) return false;
  if (ctx.role === "admin") return true;
  if (operation === "create") {
    // canCreateAccount: admin, or manager with org, or SE with org+team.
    return (ctx.role === "manager" && !!ctx.orgId) ||
      (ctx.role === "se" && !!ctx.orgId && !!ctx.teamId);
  }
  // update: admin or manager (SEs can update accounts they can read, but
  // without a SQL query to check the account's SE team we restrict to
  // manager+ on the SQL path; SEs fall through to Firestore which has
  // the onAccountSeTeam check).
  return ctx.role === "manager";
}

/**
 * account_se_team (26_account_se_team.sql) has existed since Sep 7 with a
 * correct RLS policy, but nothing ever inserted into it -- so every account
 * stayed "unclaimed" regardless of who actually worked it, and the P0 fix's
 * account_writable_by_current_user check kept passing on the unclaimed
 * branch instead of the real membership branch. This is that missing insert:
 * account-service.js's createAccount/ensureSeTeamForPrepActor send a
 * Firestore-shaped seTeam array ({seUserId, role, addedBy}[]); land each
 * member as a real row. Best-effort per member -- one bad member (unmigrated
 * app_user, etc.) shouldn't abort the account write it's attached to.
 */
async function seatAccountSeTeamFromDoc(
  port: PersistencePort,
  client: PgClient,
  accountPublicId: string,
  seTeam: unknown,
): Promise<void> {
  if (!Array.isArray(seTeam)) return;
  for (const raw of seTeam) {
    const member = (raw || {}) as Record<string, unknown>;
    const seUserPublicId = stringField(member.seUserId);
    if (!seUserPublicId) continue;
    try {
      await port.seatAccountSeTeamMember(client, {
        accountPublicId,
        seUserPublicId,
        role: member.role === "primary" ? "primary" : "secondary",
        addedByPublicId: nullableString(member.addedBy),
      });
    } catch (err) {
      console.warn(
        `[domain-write] seatAccountSeTeamMember skipped for account=${accountPublicId} se=${seUserPublicId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Route CRM domain writes through the persistence port when PERSISTENCE_MODE
 * is dual/sql. Returns { handled: false } for non-CRM methods, firestore
 * mode, or when the caller has no SQL session yet (pre-migration user) — the
 * caller falls through to the legacy Firestore path.
 */
/**
 * Exported for tests only. Route-level idempotency cannot be asserted through
 * handleDomainWrite without a full authenticated request, and the id
 * derivation this function performs (see the upsertArrOverride and
 * addContactEvent cases) is exactly what roadmap 3.5 fixed — a test that
 * supplies its own public_id proves the repository's ON CONFLICT works, which
 * was never the broken part.
 */
export async function trySqlDomainWrite(
  env: Env,
  verified: VerifiedUser | null,
  method: string,
  args: unknown[],
  request: Request,
): Promise<{ handled: boolean; result?: unknown }> {
  const port = resolvePersistencePort(env);
  if (!port || !postgresReady(env)) {
    return fallback({ method, reason: "postgres_not_configured" }, env);
  }
  // LOCAL DEV ONLY: dummy auth mode has no verified user, so the SQL path was
  // unreachable without Google SSO — which meant nobody could exercise
  // Postgres end-to-end locally, and the whole cutover stayed unverifiable.
  //
  // When Firebase verification is OFF, accept a claimed identity from a header
  // and look the person up by email. Safe because it is gated on exactly the
  // condition node-server.ts REFUSES TO BOOT with in production
  // (FIREBASE_PROJECT_ID missing or FIREBASE_AUTH_ENFORCED=0 + NODE_ENV=production),
  // so this branch cannot exist in a deployed environment. The header is a
  // claim, never a credential.
  let devEmail: string | null = null;
  let actor = verified;
  if (!actor?.uid && !firebaseAuthEnforced(env)) {
    const claimed = (request.headers.get("X-Dev-User-Email") || "").trim().toLowerCase();
    if (claimed) {
      console.warn(
        `[dev-auth] trusting claimed identity "${claimed}" for ${method} — ` +
          `Firebase verification is disabled. Local development only.`,
      );
      // A synthetic uid keyed on the email, so resolveSqlSession's binding
      // path behaves exactly as it does for a real first sign-in.
      devEmail = claimed;
      actor = { uid: `devuid_${claimed.replace(/[^a-z0-9]+/g, "_")}`, email: claimed };
    }
  }
  if (!actor?.uid) {
    return fallback({ method, reason: "no_verified_user" }, env);
  }
  const verifiedActor = actor;

  // The dev path resolves by email and never touches user_identity: the
  // claimed email usually belongs to someone who ALREADY has a real Firebase
  // uid, and bindAuthIdentity rightly refuses to attach a second one — it
  // cannot distinguish a dev header from an impersonation attempt.
  const session = devEmail
    ? await resolveSqlSessionByEmail(devEmail, env)
    : await resolveSqlSession(verifiedActor.uid, env, verifiedActor.email);
  if (!session) {
    // The person has no app_user/user_identity row, so there is no session to
    // scope RLS with. resolveSqlSession binds the identity on first login when
    // the app_user exists, so this means they are genuinely unprovisioned.
    return fallback(
      { method, reason: "no_sql_session", detail: verifiedActor.email },
      env,
    );
  }

  const doc = (args[0] || {}) as Record<string, unknown>;

  // M1 fix: for un-RLS'd tables (account, contact), resolve the Firestore-based
  // RequestContext and check app-layer authorization before the SQL write.
  // If the check fails, fall through to Firestore (which has security rules).
  const UNSCOPED_METHODS = new Set([
    "createAccount", "updateAccount", "createContact", "updateContact",
  ]);
  if (UNSCOPED_METHODS.has(method)) {
    // account and contact have no org_unit_id, so RLS cannot scope them and
    // the check has to happen app-side. It used to come from
    // resolveRequestContext, which reads the Firestore authIndex collection --
    // a hard FIRESTORE DEPENDENCY inside the SQL write path. In sql mode that
    // is both wrong and fatal: every account and contact write failed with
    // "context unresolvable" because the Firestore lookup could not be made.
    //
    // The SQL session already carries what the decision needs, so derive the
    // context from Postgres and keep Firestore out of it entirely.
    let ctx: RequestContext | null = null;
    try {
      const roleRow = await (await getPool(env)).query(
        `SELECT COALESCE(vr.role_name, 'se') AS role, u.org_unit_id,
                split_part(trim(both '/' from COALESCE(ou.path, '')), '/', 1) AS org_id
           FROM app_user u
           LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
           LEFT JOIN v_user_current_role vr ON vr.user_id = u.id
          WHERE u.id = $1
          ORDER BY (vr.role_name = 'admin') DESC
          LIMIT 1`,
        [session.userId],
      );
      const row = roleRow.rows[0];
      if (row) {
        ctx = {
          role: String(row.role),
          orgId: row.org_id ? String(row.org_id) : null,
          teamId: row.org_unit_id ? String(row.org_unit_id) : null,
        } as unknown as RequestContext;
      }
    } catch (err) {
      return fallback({
        method, reason: "not_authorized",
        detail: `could not resolve role from Postgres: ${err instanceof Error ? err.message : err}`,
      }, env);
    }
    const op = method.startsWith("update") ? "update" : "create";
    if (!canWriteUnscopedResource(ctx, op)) {
      // P0 fix (Sep 7): SE-role updates were blanket-denied on the SQL path and
      // "fell through to Firestore" — but staging is SQL-read-primary, so those
      // writes were effectively lost (115 not_authorized entries on Sep 7 alone,
      // and the prep flow's account provisioning aborted with them).
      // The account RLS policy (account_se_team_owner_write) already encodes the
      // real team rule: admin OR mapped-in-account_se_team OR no mapping exists.
      // For updates with an explicit account id, defer to that exact predicate
      // via SQL instead of the role-name heuristic.
      if (op === "update" && method === "updateAccount" && session?.userId != null) {
        const targetId = stringField(doc.id);
        if (targetId && method === "updateAccount") {
          try {
            // The predicate reads app.user_id via current_user_id(), so the
            // variable must already be set when it evaluates. Setting it in the
            // same SELECT target list did not work: target-list evaluation order
            // is unspecified, so the predicate saw NULL and denied writes the
            // policy allows — 1130 lost updateAccount writes. Go through the
            // session helper, which opens a transaction and sets the variables
            // in an earlier statement.
            if (await accountWritableBySession(session, targetId, env)) {
              // fall through to the SQL write with the session RLS scoping it
            } else {
              return fallback(
                { method, reason: "not_authorized", detail: `role=${ctx?.role ?? "unknown"} op=${op} (rls-writable check false)` },
                env,
              );
            }
          } catch (wErr) {
            return fallback({
              method, reason: "not_authorized",
              detail: `writability check failed: ${wErr instanceof Error ? wErr.message : wErr}`,
            }, env);
          }
        } else {
          return fallback(
            { method, reason: "not_authorized", detail: `role=${ctx?.role ?? "unknown"} op=${op} (no target id)` },
            env,
          );
        }
      } else {
        return fallback(
          { method, reason: "not_authorized", detail: `role=${ctx?.role ?? "unknown"} op=${op}` },
          env,
        );
      }
    }
  }

  const handled = await withSessionContext(session, async (client) => {
    switch (method) {
      case "createAccount": {
        const id = stringField(doc.id);
        if (!id) return { handled: false as const };
        await port.upsertAccount(client, {
          publicId: id,
          name: stringField(doc.name) || "Unknown",
          domain: nullableString(doc.domain),
          slug: nullableString(doc.slug),
          industry: nullableString(doc.industry),
          healthData: (doc.health as Record<string, unknown>) ?? null,
          externalRef: nullableString(doc.externalRef),
        });
        if ("seTeam" in doc) await seatAccountSeTeamFromDoc(port, client, id, doc.seTeam);
        return { handled: true as const, result: doc };
      }
      case "updateAccount": {
        // Legacy signature: updateAccount(id, patch). args[0] is the id.
        const id = stringField(args[0]);
        if (!id) return { handled: false as const };
        const patch = (args[1] || {}) as Record<string, unknown>;
        const fields: Partial<Omit<AccountRow, "publicId">> = {};
        if ("name" in patch) fields.name = stringField(patch.name) || "Unknown";
        if ("domain" in patch) fields.domain = nullableString(patch.domain);
        if ("slug" in patch) fields.slug = nullableString(patch.slug);
        if ("industry" in patch) fields.industry = nullableString(patch.industry);
        if ("health" in patch) fields.healthData = (patch.health as Record<string, unknown>) ?? null;
        if ("externalRef" in patch) fields.externalRef = nullableString(patch.externalRef);
        if (Object.keys(fields).length) await port.patchAccount(client, id, fields);
        if ("seTeam" in patch) await seatAccountSeTeamFromDoc(port, client, id, patch.seTeam);
        return { handled: true as const, result: { id, ...patch } };
      }
      case "createContact": {
        const id = stringField(doc.id);
        const accountId = stringField(doc.accountId);
        if (!id || !accountId) return { handled: false as const };
        await port.upsertContact(client, {
          publicId: id,
          accountPublicId: accountId,
          email: stringField(doc.email),
          name: nullableString(doc.name),
          title: nullableString(doc.title),
          role: nullableString(doc.role),
        });
        return { handled: true as const, result: doc };
      }
      case "updateContact": {
        // Legacy signature: updateContact(id, patch).
        const id = stringField(args[0]);
        if (!id) return { handled: false as const };
        const patch = (args[1] || {}) as Record<string, unknown>;
        await port.patchContact(client, id, {
          ...(patch.accountId !== undefined ? { accountPublicId: stringField(patch.accountId) } : {}),
          ...(patch.email !== undefined ? { email: stringField(patch.email) } : {}),
          ...(patch.name !== undefined ? { name: nullableString(patch.name) } : {}),
          ...(patch.title !== undefined ? { title: nullableString(patch.title) } : {}),
          ...(patch.role !== undefined ? { role: nullableString(patch.role) } : {}),
        });
        return { handled: true as const, result: { id, ...patch } };
      }
      case "createDeal": {
        const id = stringField(doc.id);
        const accountId = stringField(doc.accountId);
        const ownerId = stringField(doc.ownerId);
        const orgUnitId = stringField(doc.teamId) || stringField(doc.orgId);
        if (!id || !accountId || !ownerId || !orgUnitId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
        }
        await port.upsertDeal(client, {
          publicId: id,
          accountPublicId: accountId,
          ownerPublicId: ownerId,
          orgUnitId,
          name: stringField(doc.title) || stringField(doc.name) || "Untitled deal",
          stage: stringField(doc.stage) || "prospecting",
          status: nullableString(doc.status) ?? "active",
          amount: typeof doc.amount === "number" ? doc.amount : null,
          currencyCode: stringField(doc.currency) || "USD",
        });
        return { handled: true as const, result: doc };
      }
      case "updateDeal": {
        // Legacy signature: updateDeal(id, patch).
        const id = stringField(args[0]);
        if (!id) return { handled: false as const };
        const patch = (args[1] || {}) as Record<string, unknown>;
        await port.patchDeal(client, id, {
          ...(patch.accountId !== undefined ? { accountPublicId: stringField(patch.accountId) } : {}),
          ...(patch.ownerId !== undefined ? { ownerPublicId: stringField(patch.ownerId) } : {}),
          ...(patch.teamId !== undefined || patch.orgId !== undefined
            ? { orgUnitId: stringField(patch.teamId) || stringField(patch.orgId) }
            : {}),
          ...(patch.title !== undefined || patch.name !== undefined
            ? { name: stringField(patch.title) || stringField(patch.name) || "Untitled deal" }
            : {}),
          ...(patch.stage !== undefined ? { stage: stringField(patch.stage) } : {}),
          ...(patch.status !== undefined ? { status: nullableString(patch.status) ?? "active" } : {}),
          ...(patch.amount !== undefined ? { amount: typeof patch.amount === "number" ? patch.amount : null } : {}),
          ...(patch.currency !== undefined ? { currencyCode: stringField(patch.currency) || "USD" } : {}),
        });
        return { handled: true as const, result: { id, ...patch } };
      }
      case "createDealContact": {
        const dealId = stringField(doc.dealId);
        const contactId = stringField(doc.contactId);
        if (!dealId || !contactId) return { handled: false as const };
        const id = dealContactId(dealId, contactId);
        await port.upsertDealContact(client, {
          publicId: id,
          dealPublicId: dealId,
          contactPublicId: contactId,
          role: nullableString(doc.role),
          isPrimary: doc.isPrimary === true,
        });
        return { handled: true as const, result: { ...doc, id } };
      }
      case "setPrimaryDealContact": {
        const dealId = stringField(args[0]);
        const contactId = stringField(args[1]);
        if (!dealId || !contactId) return { handled: false as const };
        await port.setPrimaryDealContact(client, dealId, contactId);
        return { handled: true as const, result: { dealId, contactId, isPrimary: true } };
      }
      case "removeDealContact": {
        const dealId = stringField(args[0]);
        const contactId = stringField(args[1]);
        if (!dealId || !contactId) return { handled: false as const };
        await port.removeDealContact(client, dealId, contactId);
        return { handled: true as const, result: null };
      }
      case "addLifecycleEvent": {
        const mapped = await applyLifecycleEvent(client, doc as LifecycleEventInput);
        return { handled: true as const, result: { mapped } };
      }
      case "createPrepBrief": {
        const id = stringField(doc.id);
        const accountId = stringField(doc.accountId);
        const ownerId = stringField(doc.ownerId);
        const orgUnitId = stringField(doc.teamId) || stringField(doc.orgId);
        if (!id || !accountId || !ownerId || !orgUnitId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
        }
        const brief = (doc.prep as Record<string, unknown>) ?? (doc.brief as Record<string, unknown>) ?? null;
        const input = (doc.input as Record<string, unknown>) ?? null;
        // QA #10: an unknown shape must not 500 the request — fall through to
        // the legacy Firestore path so the write still lands.
        try {
          validateJsonbShape("pre_call.research_brief", brief);
          validateJsonbShape("pre_call.input_snapshot", input);
        } catch (shapeErr) {
          logFallback({
            method, reason: "shape_validation_failed", entityPublicId: id,
            detail: shapeErr instanceof Error ? shapeErr.message : String(shapeErr),
          }, env);
          return { handled: false as const };
        }
        // Provision the account if it lives only in Firestore, so the pre_call
        // FK resolves instead of 500-ing the prep dual-write (mirrors the
        // history/post-call path — this is why pre_call was frozen).
        {
          const inputSnap = (input as Record<string, unknown>) ?? {};
          await ensureAccountProvisioned(
            client,
            port,
            accountId,
            stringField(doc.accountName) || stringField(doc.company) || stringField(inputSnap.companyName) || stringField(doc.title),
            nullableString(doc.accountDomain) ?? nullableString(inputSnap.companyDomain),
          );
        }
        const activityPublicId = `act_${id}`;
        // D24: a prep brief is always tied to a deal, enforced by
        // trg_pre_call_deal_required. Fall back to lifecycleId when dealId is
        // absent -- PrepBrief.dealId is optional in Firestore while
        // lifecycleId is required, and 86 of the 87 briefs already in Postgres
        // have no deal, so without this fallback almost every new brief would
        // be rejected outright.
        //
        // Using the lifecycle as the deal identity is right for this model
        // rather than a workaround: a lifecycle IS the pursuit the brief
        // belongs to, and ensureDealRef mints a minimal placeholder for an
        // unmapped id which a later real createDeal upserts over
        // (ON CONFLICT public_id DO UPDATE).
        const prepLifecycleRef =
          nullableString(doc.dealId) ?? nullableString(doc.lifecycleId);
        if (!prepLifecycleRef) {
          // Neither id: there is nothing to tie the brief to, so let it land in
          // Firestore rather than 500 the request. Loud in the log, because a
          // brief with no lifecycle should not be reachable from the UI.
          logFallback({ method, reason: "no_deal_or_lifecycle", entityPublicId: id }, env);
          return { handled: false as const };
        }
        const prepDealRef = await ensureDealRef(
          client, port, prepLifecycleRef,
          accountId, ownerId, orgUnitId, nullableString(doc.title) ?? "Untitled deal",
        );
        if (!prepDealRef) {
          logFallback({
            method, reason: "deal_provision_failed",
            entityPublicId: id, detail: prepLifecycleRef,
          }, env);
          return { handled: false as const };
        }
        await port.upsertActivity(client, {
          publicId: activityPublicId,
          idempotencyKey: `prep_${id}`,
          dealPublicId: prepDealRef,
          accountPublicId: accountId,
          ownerPublicId: ownerId,
          orgUnitId,
          activityType: "meeting",
          subject: nullableString(doc.title) ?? "Prep",
          occurredAt: toIso(doc.createdAt) ?? new Date().toISOString(),
        });
        await port.upsertPreCall(client, {
          publicId: id,
          idempotencyKey: `prep_${id}`,
          activityPublicId,
          researchBrief: brief,
          inputSnapshot: input,
        });
        return { handled: true as const, result: doc };
      }
      // ---------------------------------------------------------------------
      // QIP scores (D3, D26). The browser persists a scorecard as a header
      // call followed by one call per theme -- see
      // web/domain/scorecard-service.js persistScorecardDraft -- so both
      // methods are handled and the header clears the themes it will receive.
      //
      // This is what made scoring impossible before the reshape:
      // composite_score was CHECK (0..2) while overall is 0-10, so every
      // insert above 2 was rejected outright.
      // ---------------------------------------------------------------------
      case "upsertScorecard": {
        const sc = doc;
        const id = stringField(sc.id);
        const callId = stringField(sc.callId);
        const ownerId = stringField(sc.ownerId);
        const orgUnitId = stringField(sc.teamId) || stringField(sc.orgId);
        const rubricId = stringField(sc.rubricId);
        const callType = stringField(sc.callType);
        if (!id || !callId || !ownerId || !orgUnitId || !rubricId || !callType) {
          return { handled: false as const };
        }
        // The scorecard hangs off the call's activity, which the post-call
        // write created as act_<callId>. If it is not in Postgres yet the
        // post-call dual-write did not land, and scoring a call we have no
        // record of would be worse than falling back.
        const activityPublicId = `act_${callId}`;
        const activityMapped = await client.query(
          `SELECT resolve_internal_id('activity', $1) AS id`,
          [activityPublicId],
        );
        if (activityMapped.rows[0]?.id == null) {
          logFallback({
            method, reason: "unmapped_parent",
            entityPublicId: id, detail: `activity ${activityPublicId}`,
          }, env);
          return { handled: false as const };
        }
        const categoryScores =
          (sc.categoryScores as Record<string, number | null> | undefined) ?? undefined;
        await port.upsertScorecard(client, {
          publicId: id,
          activityPublicId,
          rubricId,
          ownerPublicId: ownerId,
          orgUnitId,
          callType,
          seMotion: canonicalizeSeMotion(sc.seMotion),
          // seMotionSource deliberately omitted — the repository resolves it
          // against the org tree rather than trusting the client (D14).
          rubricVersion: stringField(sc.rubricVersion) || "2.1",
          compositeScore: typeof sc.overall === "number" ? sc.overall : null,
          totalCredits: typeof sc.totalCredits === "number" ? sc.totalCredits : null,
          includedCredits: typeof sc.includedCredits === "number" ? sc.includedCredits : null,
          confidence: typeof sc.confidence === "number" ? sc.confidence : null,
          categoryScores,
          provisional: typeof sc.provisional === "boolean" ? sc.provisional : undefined,
          leadershipShareable: !!sc.leadershipShareable,
          goldenCalibrated: !!sc.goldenCalibrated,
          verifierJustifications: sc.verifierJustifications ?? null,
          goldenJustifications: sc.goldenJustifications ?? null,
          dealRiskFlags: Array.isArray(sc.dealRiskFlags)
            ? (sc.dealRiskFlags as Array<Record<string, unknown>>)
                .map((f) => ({
                  category: stringField(f.category) as
                    | "claim_to_verify" | "commitment_outside_remit"
                    | "missing_stakeholder" | "process_gap" | "legal_compliance",
                  description: stringField(f.description) || "(no description)",
                  severity: (nullableString(f.severity) as "low" | "medium" | "high" | null),
                  atS: typeof f.atS === "number" ? f.atS : null,
                  quote: nullableString(f.quote),
                }))
                .filter((f) => !!f.category)
            : [],
        });
        return { handled: true as const, result: doc };
      }

      case "upsertScorecardLine": {
        // One theme, despite the legacy method name: the Firestore
        // scorecardLines collection is at the theme grain and carries the five
        // sub-parameter verdicts inline.
        const line = doc;
        const scorecardId = stringField(line.scorecardId);
        const themeKey = stringField(line.themeKey);
        if (!scorecardId || !themeKey) return { handled: false as const };

        const known = await client.query(
          `SELECT 1 FROM scorecard WHERE public_id = $1`, [scorecardId]);
        if (known.rowCount === 0) {
          logFallback({
            method, reason: "unmapped_parent",
            entityPublicId: scorecardId, detail: "scorecard header not in Postgres",
          }, env);
          return { handled: false as const };
        }

        const subs = Array.isArray(line.subParameters)
          ? (line.subParameters as Array<Record<string, unknown>>).map((sp) => ({
              score: typeof sp.score === "number" ? sp.score : null,
              evidenceJson: sp.evidence ?? null,
            }))
          : [];

        await port.upsertScorecardTheme(client, {
          scorecardPublicId: scorecardId,
          themeKey,
          grade: typeof line.grade === "number" ? line.grade : null,
          credit: typeof line.credit === "number" ? line.credit : 1,
          category: stringField(line.category) || "communication_control",
          evidenceUnavailable: !!line.evidenceUnavailable,
          modelOmitted: !!line.modelOmitted,
          notApplicableReason: nullableString(line.notApplicableReason),
          confidence: typeof line.confidence === "number" ? line.confidence : null,
          coachingNote: nullableString(line.coachingNote),
          subParameters: subs,
        });
        return { handled: true as const, result: doc };
      }

      // =====================================================================
      // post_call.detail items — twelve upserts and their deletes.
      //
      // These collections are stored as arrays INSIDE post_call.detail, which
      // is where both browser stores read them from (detailArray()). So they
      // are a jsonb upsert on the call, not separate tables.
      // =====================================================================
      case "upsertVideoFacts":
      case "upsertTimelineSegment":
      case "upsertTimelineMarker":
      case "upsertFollowUp":
      case "upsertMomDraft":
      case "upsertDealSignal":
      case "upsertObjection":
      case "upsertArrLine":
      case "upsertWhatWorks":
      case "upsertTcDelta":
      case "upsertMeddpiccDelta": {
        const DETAIL_KEY: Record<string, string> = {
          upsertVideoFacts: "videoFacts",
          upsertTimelineSegment: "timelineSegments",
          upsertTimelineMarker: "timelineMarkers",
          upsertFollowUp: "followUps",
          upsertMomDraft: "momDrafts",
          upsertDealSignal: "dealSignals",
          upsertObjection: "objections",
          upsertArrLine: "arrLines",
          upsertWhatWorks: "whatWorks",
          upsertTcDelta: "tcDeltas",
          upsertMeddpiccDelta: "meddpiccDeltas",
        };
        const key = DETAIL_KEY[method];
        // These docs carry the call under one of several names depending on
        // which pass produced them.
        const callId = stringField(doc.callId) || stringField(doc.postCallId)
          || stringField(doc.callPublicId);
        const itemId = stringField(doc.id);
        if (!key || !callId || !itemId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: itemId }, env);
        }
        const mapped = await client.query(
          `SELECT resolve_internal_id('post_call', $1) AS id`, [callId]);
        if (mapped.rows[0]?.id == null) {
          // The call itself is not in Postgres, so its detail item has nothing
          // to attach to. Loud, because in sql mode there is no second chance.
          logFallback({
            method, reason: "unmapped_parent", entityPublicId: itemId,
            detail: `post_call ${callId}`,
          }, env);
          return { handled: false as const };
        }
        await port.upsertDetailItem(client, {
          callPublicId: callId, key, item: doc as Record<string, unknown>,
        });
        return { handled: true as const, result: doc };
      }

      case "deleteVideoFacts":
      case "deleteFollowUp":
      case "deleteMomDraft":
      case "deleteDealSignal":
      case "deleteObjection":
      case "deleteArrLine":
      case "deleteTcDelta":
      case "deleteMeddpiccDelta": {
        // Legacy signature: delete<X>(id, callId?) — args[0] is the item id.
        const DEL_KEY: Record<string, string> = {
          deleteVideoFacts: "videoFacts",
          deleteFollowUp: "followUps",
          deleteMomDraft: "momDrafts",
          deleteDealSignal: "dealSignals",
          deleteObjection: "objections",
          deleteArrLine: "arrLines",
          deleteTcDelta: "tcDeltas",
          deleteMeddpiccDelta: "meddpiccDeltas",
        };
        const key = DEL_KEY[method];
        const itemId = stringField(args[0]) || stringField(doc.id);
        const callId = stringField(args[1]) || stringField(doc.callId);
        if (!key || !itemId) {
          return fallback({ method, reason: "missing_required_field" }, env);
        }
        if (callId) {
          await port.deleteDetailItem(client, { callPublicId: callId, key, itemId });
          return { handled: true as const, result: { id: itemId } };
        }
        // No call id supplied: find the call holding the item rather than
        // guessing, so a delete never silently no-ops.
        const owner = await client.query(
          `SELECT pc.public_id FROM post_call pc
            WHERE jsonb_path_exists(COALESCE(pc.detail, '{}'::jsonb),
                    ('$."' || $2 || '"[*] ? (@.id == "' || $1 || '")')::jsonpath)
            LIMIT 1`,
          [itemId, key],
        );
        const found = owner.rows[0]?.public_id as string | undefined;
        if (!found) {
          logFallback({
            method, reason: "unmapped_parent", entityPublicId: itemId,
            detail: `no post_call holds a ${key} item with this id`,
          }, env);
          return { handled: false as const };
        }
        await port.deleteDetailItem(client, { callPublicId: found, key, itemId });
        return { handled: true as const, result: { id: itemId } };
      }

      case "deleteTimelineSegmentsByVideoFactsId":
      case "deleteTranscriptTimelineByCall": {
        const callId = stringField(args[0]) || stringField(doc.callId);
        if (!callId) return fallback({ method, reason: "missing_required_field" }, env);
        await port.clearDetailKeys(client, {
          callPublicId: callId, keys: ["timelineSegments", "timelineMarkers"],
        });
        return { handled: true as const, result: { callId } };
      }

      // =====================================================================
      // post_call and its summary
      // =====================================================================
      case "upsertPostCall":
      case "upsertCallSummary": {
        // The plain variants, without the account/deal provisioning that
        // upsertPostCallWithSummary does. Only ever an UPDATE of a call that
        // already exists, so a missing one is a real error.
        const id = stringField(doc.id) || stringField(doc.callId);
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);
        const mapped = await client.query(
          `SELECT resolve_internal_id('post_call', $1) AS id`, [id]);
        if (mapped.rows[0]?.id == null) {
          logFallback({ method, reason: "unmapped_parent", entityPublicId: id }, env);
          return { handled: false as const };
        }
        const patch: Record<string, unknown> = {};
        if (doc.analysis) patch.analysis = doc.analysis;
        if (doc.detail) patch.detail = doc.detail;
        if (doc.summary) patch.summary = doc.summary;
        // identities arrive here too — same participant derivation as the
        // full post-call path, so the two cannot disagree.
        const ids2 = (doc.identities as Record<string, unknown> | undefined) ?? null;
        await client.query(
          `UPDATE post_call SET
             analysis = COALESCE($2::jsonb, analysis),
             detail   = COALESCE($3::jsonb, detail),
             updated_at = now()
           WHERE public_id = $1`,
          [id,
           doc.analysis ? JSON.stringify(doc.analysis) : null,
           doc.detail ? JSON.stringify(doc.detail) : null],
        );
        if (ids2) {
          const actPub = `act_${stringField(doc.callId) || id}`;
          await client.query("SAVEPOINT dw_p2");
          try {
            await port.replaceCallParticipants(client, {
              activityPublicId: actPub,
              primarySeUserPublicId: nullableString(ids2.primarySeUserId),
              secondarySeUserPublicIds: Array.isArray(ids2.secondarySeUserIds)
                ? (ids2.secondarySeUserIds as unknown[]).map(String) : [],
              aeName: nullableString(ids2.aeName),
              aeEmail: nullableString(ids2.aeEmail),
              contactPublicIds: Array.isArray(ids2.contactIds)
                ? (ids2.contactIds as unknown[]).map(String) : [],
            });
            await client.query("RELEASE SAVEPOINT dw_p2");
          } catch {
            await client.query("ROLLBACK TO SAVEPOINT dw_p2").catch(() => undefined);
          }
        }
        return { handled: true as const, result: doc };
      }

      // =====================================================================
      // Lifecycle IS deal in this model
      // =====================================================================
      case "createLifecycle":
      case "updateLifecycle": {
        const id = method === "updateLifecycle"
          ? (stringField(args[0]) || stringField(doc.id))
          : stringField(doc.id);
        const patch = method === "updateLifecycle"
          ? ((args[1] || {}) as Record<string, unknown>)
          : doc;
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);

        if (method === "createLifecycle") {
          const accountId = stringField(doc.accountId);
          const ownerId = stringField(doc.ownerId);
          const orgUnitId = stringField(doc.teamId) || stringField(doc.orgId);
          if (!accountId || !ownerId || !orgUnitId) {
            return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
          }
          await ensureAccountProvisioned(
            client, port, accountId,
            stringField(doc.title) || "Unknown", nullableString(doc.accountDomain));
          await port.upsertDeal(client, {
            publicId: id, accountPublicId: accountId, ownerPublicId: ownerId,
            orgUnitId, name: stringField(doc.title) || "Untitled deal",
            stage: stringField(doc.stage) || "prospecting",
            status: stringField(doc.status) || "active",
          });
          return { handled: true as const, result: doc };
        }

        const fields: Partial<Omit<DealRow, "publicId">> = {};
        if ("title" in patch) fields.name = stringField(patch.title) || "Untitled deal";
        if ("stage" in patch) fields.stage = stringField(patch.stage);
        if ("status" in patch) fields.status = stringField(patch.status);
        if (Object.keys(fields).length === 0) {
          return { handled: true as const, result: { id } };
        }
        await port.patchDeal(client, id, fields);
        return { handled: true as const, result: { id, ...fields } };
      }

      // =====================================================================
      // Tasks (D8) — task was read-only; writes went to a per-user KV blob
      // =====================================================================
      case "createTask":
      case "updateTask": {
        const id = method === "updateTask"
          ? (stringField(args[0]) || stringField(doc.id))
          : stringField(doc.id);
        const src = method === "updateTask"
          ? { ...(doc as Record<string, unknown>), ...((args[1] || {}) as Record<string, unknown>) }
          : doc;
        const ownerId = stringField(src.ownerId) || stringField(doc.ownerId);
        const title = stringField(src.title);
        if (!id || !ownerId || !title) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
        }
        const callId = nullableString(src.callId);
        await port.upsertTask(client, {
          publicId: id,
          activityPublicId: callId ? `act_${callId}` : null,
          dealPublicId: nullableString(src.dealId) ?? nullableString(src.lifecycleId),
          ownerPublicId: ownerId,
          title,
          description: nullableString(src.description),
          status: stringField(src.status) || "open",
          dueDate: nullableString(src.due) ?? nullableString(src.dueDate),
          source: stringField(src.source) === "ai_generated" ? "ai_generated" : "manual",
          taskKey: nullableString(src.sourceKey),
          completedAt: toIso(src.completedAt),
        });
        return { handled: true as const, result: { id, ...src } };
      }

      case "deleteTask": {
        const id = stringField(args[0]) || stringField(doc.id);
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);
        await port.softDeleteTask(client, id);
        return { handled: true as const, result: { id } };
      }

      // =====================================================================
      // The five tables from 31_remaining_collections.sql
      // =====================================================================
      case "addContactEvent": {
        const contactId = stringField(args[0]) || stringField(doc.contactId);
        const ev = ((args[1] || doc.event || doc) as Record<string, unknown>) ?? {};
        // A caller-supplied id always wins. Otherwise derive it from CONTENT,
        // not the clock: `ce_${contactId}_${Date.now()}` made every retry a
        // new public_id, so addContactEvent's ON CONFLICT (public_id) DO
        // NOTHING could never fire and a double-submit appended a duplicate
        // event (§07.3 / roadmap 3.5).
        const evId =
          stringField(ev.id) ||
          deterministicAppendId("ce", contactId, {
            eventType: stringField(ev.type) || stringField(ev.eventType),
            actorId: nullableString(ev.actorId),
            payload: ev.payload ?? null,
          });
        const evType = stringField(ev.type) || stringField(ev.eventType);
        if (!contactId || !evType) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: contactId }, env);
        }
        await port.addContactEvent(client, {
          publicId: evId, contactPublicId: contactId, eventType: evType,
          actorPublicId: nullableString(ev.actorId), payload: ev.payload ?? null,
        });
        return { handled: true as const, result: { id: evId } };
      }

      case "upsertDealSummary": {
        const dealId = stringField(doc.dealId);
        if (!dealId) return fallback({ method, reason: "missing_required_field" }, env);
        await port.upsertDealSummary(client, {
          publicId: stringField(doc.id) || `dsum_${dealId}`,
          dealPublicId: dealId,
          summary: nullableString(doc.summary),
          payload: doc,
        });
        return { handled: true as const, result: doc };
      }

      case "upsertAccountSummary": {
        const accountId = stringField(doc.accountId);
        if (!accountId) return fallback({ method, reason: "missing_required_field" }, env);
        await port.upsertAccountSummary(client, {
          publicId: stringField(doc.id) || `asum_${accountId}`,
          accountPublicId: accountId,
          summary: nullableString(doc.summary),
          payload: doc,
        });
        return { handled: true as const, result: doc };
      }

      case "upsertTechnicalCommit": {
        const dealId = stringField(doc.dealId);
        const accountId = stringField(doc.accountId);
        const ownerId = stringField(doc.ownerId);
        const orgUnitId = stringField(doc.teamId) || stringField(doc.orgId);
        if (!dealId || !accountId || !ownerId || !orgUnitId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: dealId }, env);
        }
        await port.upsertTechnicalCommit(client, {
          publicId: stringField(doc.id) || `tc_${dealId}`,
          dealPublicId: dealId, accountPublicId: accountId,
          ownerPublicId: ownerId, orgUnitId, payload: doc,
        });
        return { handled: true as const, result: doc };
      }

      case "upsertArrOverride": {
        const dealId = stringField(doc.dealId);
        const newValue = typeof doc.newValue === "number" ? doc.newValue
          : typeof doc.value === "number" ? doc.value : null;
        if (!dealId || newValue == null) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: dealId }, env);
        }
        await port.addArrOverride(client, {
          // Content-derived, not clock-derived — see deterministicAppendId.
          // The previous `aov_${dealId}_${Date.now()}` defeated the
          // ON CONFLICT guard in addArrOverride, so a retry appended a second
          // ARR override to what is meant to be an audit trail.
          publicId:
            stringField(doc.id) ||
            deterministicAppendId("aov", dealId, {
              previousValue: typeof doc.previousValue === "number" ? doc.previousValue : null,
              newValue,
              reason: stringField(doc.reason) || "(no reason given)",
              createdBy: nullableString(doc.ownerId) ?? nullableString(doc.createdBy),
            }),
          dealPublicId: dealId,
          previousValue: typeof doc.previousValue === "number" ? doc.previousValue : null,
          newValue,
          reason: stringField(doc.reason) || "(no reason given)",
          createdByPublicId: nullableString(doc.ownerId) ?? nullableString(doc.createdBy),
        });
        return { handled: true as const, result: doc };
      }

      // =====================================================================
      // Product signals and gap clustering (D13, D20)
      // =====================================================================
      case "upsertProductGap": {
        const id = stringField(doc.id);
        const accountId = stringField(doc.accountId);
        const ownerId = stringField(doc.ownerId);
        const orgUnitId = stringField(doc.teamId) || stringField(doc.orgId);
        if (!id || !accountId || !ownerId || !orgUnitId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
        }
        const callId = nullableString(doc.callId) ?? nullableString(doc.postCallId);
        await port.upsertProductSignal(client, {
          publicId: id,
          activityPublicId: callId ? `act_${callId}` : null,
          accountPublicId: accountId,
          ownerPublicId: ownerId,
          orgUnitId,
          source: stringField(doc.source) === "pm_created" ? "pm_created"
            : stringField(doc.source) === "se_created" ? "se_created" : "ai_extracted",
          signalType: "product_gap",
          signalKey: nullableString(doc.signalKey) ?? id,
          title: stringField(doc.title) || "(untitled gap)",
          description: nullableString(doc.description),
          evidence: nullableString(doc.evidence),
        });
        return { handled: true as const, result: doc };
      }

      case "upsertGapCluster": {
        const id = stringField(doc.id);
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);
        await port.upsertSignalCluster(client, {
          publicId: id,
          name: stringField(doc.label) || stringField(doc.name) || "(unlabelled)",
          capabilityArea: nullableString(doc.capabilityArea),
          description: nullableString(doc.description),
          status: stringField(doc.status) || "draft",
          centroid: Array.isArray(doc.centroid) ? (doc.centroid as number[]) : null,
          dealCount: typeof doc.dealCount === "number" ? doc.dealCount : 0,
          arrTotal: typeof doc.arrTotal === "number" ? doc.arrTotal : 0,
          taxonomyVersion: nullableString(doc.taxonomyVersion),
          productArea: nullableString(doc.productArea),
          crossCuttingTags: Array.isArray(doc.crossCuttingTags)
            ? (doc.crossCuttingTags as string[]) : null,
          supersededBy: Array.isArray(doc.supersededBy)
            ? (doc.supersededBy as string[]) : null,
        });
        return { handled: true as const, result: doc };
      }

      case "upsertClusteringState": {
        await port.upsertClusteringState(client, {
          pendingGapCount: typeof doc.pendingGapCount === "number" ? doc.pendingGapCount : 0,
          lastIncrementalAt: toIso(doc.lastIncrementalAt),
          lastFullRunAt: toIso(doc.lastFullRunAt),
          running: doc.running === true,
        });
        return { handled: true as const, result: doc };
      }

      // =====================================================================
      // Scorecard deletes — re-scoring replaces, so this is a real delete
      // =====================================================================
      case "deleteScorecard": {
        const id = stringField(args[0]) || stringField(doc.id);
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);
        // scorecard_theme, scorecard_line and scorecard_deal_risk all cascade.
        await client.query(`DELETE FROM scorecard WHERE public_id = $1`, [id]);
        return { handled: true as const, result: { id } };
      }

      case "deleteScorecardLinesByScorecardId": {
        const id = stringField(args[0]) || stringField(doc.scorecardId);
        if (!id) return fallback({ method, reason: "missing_required_field" }, env);
        await client.query(
          `DELETE FROM scorecard_theme WHERE scorecard_id =
             (SELECT id FROM scorecard WHERE public_id = $1)`, [id]);
        return { handled: true as const, result: { scorecardId: id } };
      }

      case "upsertPostCallWithSummary": {
        const postCall = doc;
        const id = stringField(postCall.id);
        const accountId = stringField(postCall.accountId);
        const ownerId = stringField(postCall.ownerId);
        const orgUnitId = stringField(postCall.teamId) || stringField(postCall.orgId);
        if (!id || !accountId || !ownerId || !orgUnitId) {
          return fallback({ method, reason: "missing_required_field", entityPublicId: id }, env);
        }
        const analysis = (postCall.analysis as Record<string, unknown>) ?? null;
        const detail = (postCall.detail as Record<string, unknown>) ?? null;
        let analysisShapeVersion: string;
        let detailShapeVersion: string;
        try {
          analysisShapeVersion = validateJsonbShape("post_call.analysis", analysis);
          detailShapeVersion = validateJsonbShape("post_call.detail", detail);
        } catch (shapeErr) {
          logFallback({
            method, reason: "shape_validation_failed", entityPublicId: id,
            detail: shapeErr instanceof Error ? shapeErr.message : String(shapeErr),
          }, env);
          return { handled: false as const };
        }
        // Provision the account if it lives only in Firestore, so the
        // activity/post_call FK resolves instead of aborting the dual-write.
        {
          const hdr = (analysis?.callHeader as Record<string, unknown>) ?? {};
          await ensureAccountProvisioned(
            client,
            port,
            accountId,
            stringField(postCall.accountName) || stringField(hdr.company) || stringField(hdr.account) || stringField(postCall.title),
            nullableString(postCall.accountDomain) ?? nullableString(hdr.domain),
          );
        }
        const activityPublicId = `act_${id}`;
        // Same lifecycle fallback as createPrepBrief above, so a brief and the
        // call that follows it land on the SAME deal instead of one being
        // linked and the other orphaned.
        const postDealRef = await ensureDealRef(
          client, port,
          nullableString(postCall.dealId) ?? nullableString(postCall.lifecycleId),
          accountId, ownerId, orgUnitId, nullableString(postCall.title) ?? "Untitled deal",
        );
        await port.upsertActivity(client, {
          publicId: activityPublicId,
          idempotencyKey: `call_${stringField(postCall.callIdentityKey) || id}`,
          dealPublicId: postDealRef,
          accountPublicId: accountId,
          ownerPublicId: ownerId,
          orgUnitId,
          activityType: "call",
          subject: nullableString(postCall.title) ?? "Call",
          occurredAt: toIso(postCall.timestamp ?? postCall.createdAt) ?? new Date().toISOString(),
        });
        await port.upsertPostCall(client, {
          publicId: id,
          idempotencyKey: `call_${stringField(postCall.callIdentityKey) || id}`,
          activityPublicId,
          transcriptRef: nullableString(postCall.detailGcsUri) ?? nullableString(postCall.transcriptRef),
          analysis,
          detail,
          pipelineState: "analysis_done",
          analysisShapeVersion,
          detailShapeVersion,
          seMotion: seMotionFromPostCallDoc(postCall),
        });

        // Mirror the Firestore-mode handler above (case "upsertPostCallWithSummary",
        // ~line 1620): the client always sends callSummary as args[1] so the
        // callSummaries thin-list projection stays current -- summaries-service.js's
        // buildSummariesContext reads that collection to decide whether to
        // regenerate deal/account summaries. This SQL-mode handler only ever read
        // args[0], so callSummary was silently discarded for every write since
        // SQL mode went live: callSummaries never got a new entry, so
        // account.calls always came back empty, so regenerateDealAndAccountSummaries
        // never even reached the network call. Best-effort and non-fatal --
        // Firestore is a separate system from this SQL transaction, a hiccup here
        // must not roll back the post_call write that already succeeded.
        const callSummary = (args[1] || null) as Record<string, unknown> | null;
        if (callSummary && firestoreAdminReady(env)) {
          try {
            const db = await getDb(env);
            const sumRef = db.collection("callSummaries").doc(String(callSummary.id || id));
            await sumRef.set(
              stripUndefined({ ...callSummary, id: sumRef.id }) as Record<string, unknown>,
              { merge: true },
            );
          } catch (err) {
            logFallback({
              method: "upsertCallSummary",
              reason: "write_error",
              entityPublicId: id,
              detail: err instanceof Error ? err.message : String(err),
            }, env);
          }
        }

        // Participants (D9, D11). The pipeline already computes the identity
        // stamp -- stampCallIdentities in web/domain/dual-write.js -- and it
        // was being written to the postCalls doc and otherwise discarded.
        // Nothing in worker/src referenced call_participant at all.
        //
        // Best-effort on purpose: losing one participant is much better than
        // losing the call, so a failure here is logged and the post-call write
        // stands. Wrapped in a SAVEPOINT because the enclosing dual-write is
        // one transaction and an unguarded error would poison it.
        const ids = (postCall.identities as Record<string, unknown> | undefined) ?? null;
        if (ids) {
          await client.query("SAVEPOINT dual_write_participants");
          try {
            const n = await port.replaceCallParticipants(client, {
              activityPublicId,
              primarySeUserPublicId: nullableString(ids.primarySeUserId),
              secondarySeUserPublicIds: Array.isArray(ids.secondarySeUserIds)
                ? (ids.secondarySeUserIds as unknown[]).map(String)
                : [],
              aeName: nullableString(ids.aeName),
              aeEmail: nullableString(ids.aeEmail),
              contactPublicIds: Array.isArray(ids.contactIds)
                ? (ids.contactIds as unknown[]).map(String)
                : [],
            });
            await client.query("RELEASE SAVEPOINT dual_write_participants");
            if (n > 0) console.info(`[participants] ${activityPublicId}: ${n} row(s)`);
          } catch (err) {
            await client
              .query("ROLLBACK TO SAVEPOINT dual_write_participants")
              .catch(() => undefined);
            logFallback({
              method: "replaceCallParticipants",
              reason: "write_error",
              entityPublicId: activityPublicId,
              detail: err instanceof Error ? err.message : String(err),
            }, env);
          }
        }

        return { handled: true as const, result: postCall };
      }
      default:
        // No SQL path written for this method yet. This is what populates the
        // "not wired" list in the coverage report, so every unwired method
        // names itself rather than being invisible.
        logFallback({ method, reason: "method_not_implemented" }, env);
        return { handled: false as const };
    }
  }, env);
  return handled;
}

function toIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

function nullableString(value: unknown): string | null {
  const s = stringField(value);
  return s || null;
}

/**
 * Ensure an account exists in Postgres before attaching child rows (activity,
 * pre_call, post_call, …) to it. SEs routinely pick account ids that were only
 * ever written to Firestore, so the FK resolution ("id_registry: no mapping
 * for account/…") would otherwise throw and abort the whole dual-write. account
 * is un-RLS'd and the slug-dedup fix keeps the upsert collision-safe; we only
 * create when the id_registry mapping is genuinely absent, so a routine write
 * never clobbers an existing account's fields.
 */
async function ensureAccountProvisioned(
  client: PgClient,
  port: PersistencePort,
  accountId: string,
  fallbackName: string,
  domain?: string | null,
): Promise<void> {
  const mapped = await client.query(`SELECT resolve_internal_id('account', $1) AS id`, [accountId]);
  if (mapped.rows[0]?.id != null) return;
  const name = fallbackName || "Unknown";
  await port.upsertAccount(client, {
    publicId: accountId,
    name,
    domain: domain ?? null,
    slug: null,
    industry: null,
    healthData: null,
    externalRef: null,
  });
  console.info(`[dual-write] provisioned missing account ${accountId} ("${name}") in Postgres`);
}

/**
 * Mirrors normalizeAccountSlug (web/domain/types.js) closely enough that a
 * minted-here account and whatever account-service.js's upsertAccountFromPrep
 * creates moments later for the same company land on the same slug -- which
 * is what lets upsertAccount's ON CONFLICT-by-slug dedup converge them onto
 * one row. Skips the client's free-mail-domain check (a narrow edge case for
 * this app's mostly-B2B accounts) for simplicity.
 */
function mintedAccountSlug(name: string, domain?: string | null): string {
  if (domain) {
    const fromDomain = domain
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9.-]+/g, "")
      .slice(0, 48);
    if (fromDomain) return fromDomain;
  }
  const fromName = String(name || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return fromName || "account";
}

/**
 * Resolve — and, when necessary, AUTO-PROVISION — a dual-write activity's deal
 * reference. upsertActivity hard-resolves dealPublicId through the id_registry
 * and THROWS ("no mapping for deal/…") when the deal exists only in Firestore.
 *
 * Rather than dropping the link (which left activity.deal_id null and forced a
 * manual backfill nobody would notice until they went looking), we mint a
 * minimal placeholder deal — mirroring ensureAccountProvisioned — so the FK
 * links immediately and automatically. A later real createDeal upserts the same
 * public_id (ON CONFLICT public_id DO UPDATE) and overwrites name/stage/amount,
 * so the placeholder never clobbers real data.
 *
 * Safety: the enclosing dual-write runs inside a single BEGIN…COMMIT
 * (withSessionContext), so a failed INSERT would poison the whole transaction
 * and take the pre_call/post_call row down with it. We isolate the provision in
 * a SAVEPOINT: on success the deal links; on any failure (e.g. an RLS insert
 * policy rejection) we roll back just this attempt and land the activity
 * without the deal ref — the original dealId is still preserved in the row's
 * input_snapshot/analysis JSON for later reconciliation.
 *
 * Returns the deal public_id to link, or null when there is no deal at all or
 * provisioning was rejected.
 */
async function ensureDealRef(
  client: PgClient,
  port: PersistencePort,
  dealId: string | null | undefined,
  accountPublicId: string,
  ownerPublicId: string,
  orgUnitId: string,
  fallbackName: string,
): Promise<string | null> {
  const id = nullableString(dealId);
  if (!id) return null;
  const mapped = await client.query(`SELECT resolve_internal_id('deal', $1) AS id`, [id]);
  if (mapped.rows[0]?.id != null) return id;

  const name = fallbackName || "Untitled deal";
  await client.query("SAVEPOINT dual_write_deal");
  try {
    await port.upsertDeal(client, {
      publicId: id,
      accountPublicId,
      ownerPublicId,
      orgUnitId,
      name,
      stage: "prospecting",
      status: "active",
    });
    await client.query("RELEASE SAVEPOINT dual_write_deal");
    console.info(`[dual-write] provisioned missing deal ${id} ("${name}") in Postgres`);
    return id;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT dual_write_deal").catch(() => undefined);
    console.warn(
      `[dual-write] could not provision deal ${id}, landing activity without deal ref:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Option 2 — best-effort Postgres dual-write for the post-call history save.
 *
 * The staging post-call flow persists every save via POST /api/history, which
 * writes a JSON blob (KV/file/Firestore) and never touches /api/domain-write —
 * so the relational CRM tables never saw post-call data. This shreds the same
 * history entry into activity + post_call inside the writer's RLS session,
 * reusing the exact machinery the domain-write "upsertPostCallWithSummary"
 * case uses.
 *
 * Contract: this is layered ON TOP of the (already-succeeded) history blob
 * write. It must NEVER throw to the caller and must NEVER change the response —
 * every failure path returns quietly (with a loud console warn). Owner + org
 * are resolved server-side from the authenticated writer's app_user row, since
 * a history entry carries neither. Needs id + accountId on the entry, an
 * existing PG account, and analysis that passes the shape contract; anything
 * missing means we skip (Firestore blob remains the source of truth).
 */
async function tryHistoryPostCallSqlWrite(
  env: Env,
  verified: VerifiedUser | null,
  entry: HistoryEntry | undefined,
): Promise<void> {
  // astra-audit P5: every early return below used to be silent. A history POST
  // returns 200 whether or not this dual-write happened, so a skip here was
  // invisible from both the response and the logs — the exact blind spot P5
  // exists to close. Each one now records a queryable, attributable row.
  const port = resolvePersistencePort(env);
  if (!port || !postgresReady(env)) {
    logFallback({ method: "historyPostCallDualWrite", reason: "postgres_not_configured" }, env);
    return;
  }
  if (!verified?.uid) {
    logFallback({ method: "historyPostCallDualWrite", reason: "no_verified_user" }, env);
    return;
  }

  const rec = (entry ?? {}) as Record<string, unknown>;
  const id = stringField(rec.id);
  const analysis = (rec.analysis as Record<string, unknown>) ?? null;
  if (!id || !analysis) {
    logFallback(
      {
        method: "historyPostCallDualWrite",
        reason: "missing_required_field",
        detail: `entry ${id ? "has id" : "has NO id"}, analysis ${analysis ? "present" : "ABSENT"}`,
        entityPublicId: id || null,
      },
      env,
    );
    return;
  }

  const header = (analysis.callHeader as Record<string, unknown>) ?? {};
  const accountName =
    stringField(rec.accountName) || stringField(header.company) || stringField(header.account);
  const accountDomain = nullableString(rec.accountDomain) ?? nullableString(header.domain);
  let accountId = stringField(rec.accountId);
  // A genuinely brand-new account ("New account · on confirm" in the UI) has
  // no id yet at this point -- Tier 2 (resolveEngagementEntities, run only
  // if this call returns an id) is what mints one, afterward. Bailing here
  // for that case meant activity/post_call -- and therefore scorecard, which
  // FKs into activity -- could never land for ANY account's first-ever call.
  // Confirmed live on staging 2026-09-08: a fresh account got a real
  // contact + SE-team seat via Tier 2, but zero activity/post_call/scorecard,
  // because this guard bailed before Tier 2 ever ran.
  //
  // Mint an id now and provision the account with a real slug (see
  // mintedAccountSlug below) -- upsertAccount's ON CONFLICT-by-slug dedup
  // (postgres-repository.ts) converges both this row and whatever Tier 2
  // creates moments later onto the same account regardless of which
  // public_id either side used, so this can't race with or duplicate it.
  let isMintedAccountId = false;
  if (!accountId) {
    if (!accountName) {
      logFallback(
        {
          method: "historyPostCallDualWrite",
          reason: "missing_required_field",
          detail: "no accountId and no account name to mint one from",
          entityPublicId: id,
        },
        env,
      );
      return;
    }
    accountId = `acc_${crypto.randomUUID()}`;
    isMintedAccountId = true;
  }

  const session = await resolveSqlSession(verified.uid, env, verified.email);
  if (!session) {
    logFallback(
      {
        method: "historyPostCallDualWrite",
        reason: "no_sql_session",
        detail: "writer has no app_user/user_identity row — run provision-identity.mjs",
        entityPublicId: id,
      },
      env,
    );
    return;
  }

  const outcome = await withSessionContext(session, async (client) => {
    // Resolve the writer's owner public_id + org unit (text FK) — a history
    // entry carries neither, but the authenticated writer IS the call owner.
    const who = await client.query(
      `SELECT public_id, org_unit_id FROM app_user WHERE id = $1`,
      [session.userId],
    );
    const ownerId = stringField(who.rows[0]?.public_id);
    const orgUnitId = stringField(who.rows[0]?.org_unit_id);
    if (!ownerId || !orgUnitId) {
      logFallback(
        {
          method: "historyPostCallDualWrite",
          reason: "unmapped_parent",
          detail: `app_user row incomplete: public_id ${ownerId ? "ok" : "MISSING"}, org_unit_id ${orgUnitId ? "ok" : "MISSING"}`,
          entityPublicId: id,
          userPublicId: ownerId || null,
        },
        env,
      );
      return null;
    }

    if (isMintedAccountId) {
      await port.upsertAccount(client, {
        publicId: accountId,
        name: accountName || "Unknown",
        domain: accountDomain,
        slug: mintedAccountSlug(accountName, accountDomain),
        industry: null,
        healthData: null,
        externalRef: null,
      });
      console.info(`[history] minted account ${accountId} ("${accountName}") for a first-ever call`);
    } else {
      // Auto-provision the account when it exists only in Firestore, so the
      // activity/post_call FK resolves instead of aborting the dual-write.
      await ensureAccountProvisioned(client, port, accountId, accountName, accountDomain);
    }

    let analysisShapeVersion: string;
    let detailShapeVersion: string;
    try {
      analysisShapeVersion = validateJsonbShape("post_call.analysis", analysis);
      detailShapeVersion = validateJsonbShape("post_call.detail", null);
    } catch (shapeErr) {
      // The original error is carried into detail rather than discarded — P5
      // requires not swallowing it.
      logFallback(
        {
          method: "historyPostCallDualWrite",
          reason: "shape_validation_failed",
          detail: shapeErr instanceof Error ? shapeErr.message : String(shapeErr),
          entityPublicId: id,
          userPublicId: ownerId,
          ownerPublicId: ownerId,
        },
        env,
      );
      return null;
    }

    const idempotencyKey = `call_${stringField(rec.callIdentityKey) || id}`;
    const activityPublicId = `act_${id}`;
    const dealRef = await ensureDealRef(
      client, port, nullableString(rec.dealId),
      accountId, ownerId, orgUnitId, nullableString(rec.title) ?? "Untitled deal",
    );
    await port.upsertActivity(client, {
      publicId: activityPublicId,
      idempotencyKey,
      dealPublicId: dealRef,
      accountPublicId: accountId,
      ownerPublicId: ownerId,
      orgUnitId,
      activityType: "call",
      subject: nullableString(rec.title) ?? "Call",
      occurredAt: toIso(rec.timestamp ?? rec.createdAt) ?? new Date().toISOString(),
    });
    await port.upsertPostCall(client, {
      publicId: id,
      idempotencyKey,
      activityPublicId,
      transcriptRef: nullableString(rec.detailGcsUri) ?? nullableString(rec.transcriptRef),
      analysis,
      detail: null,
      pipelineState: "analysis_done",
      analysisShapeVersion,
      detailShapeVersion,
      seMotion: seMotionFromPostCallDoc(rec),
    });
    // Return a summary; the success log is emitted by the caller AFTER COMMIT
    // (withSessionContext resolves) so it can never claim a write that a later
    // ROLLBACK/connection failure actually discarded.
    return { id, accountId, ownerId };
  }, env);
  if (outcome) {
    console.info(
      `[history] dual-wrote post_call ${outcome.id} → Postgres (account ${outcome.accountId}, owner ${outcome.ownerId})`,
    );
  }
}

/**
 * Pre-call mirror of tryHistoryPostCallSqlWrite. The staging prep flow computes
 * via /api/prep/research + /api/prep/synthesize, then writes the brief straight
 * to Firestore; its createPrepBrief dual-write short-circuits client-side and
 * never reaches /api/domain-write, so pre_call stayed frozen. This lands the
 * synthesized brief into activity(meeting) + pre_call server-side, guaranteed,
 * right after synthesize succeeds.
 *
 * Contract: layered on top of the (already-computed) synthesize response — it
 * must NEVER throw to the caller and must NEVER change the 200. Owner + org come
 * from the authenticated writer's app_user row. The account is taken from an
 * explicit input.accountId when present, otherwise a deterministic placeholder
 * keyed on the company domain (so re-synth upserts the same rows rather than
 * piling up duplicates). Deal refs are best-effort (nulled when unmapped).
 */
async function tryPrepSynthesizeSqlWrite(
  env: Env,
  verified: VerifiedUser | null,
  input: Record<string, unknown>,
  prep: Record<string, unknown> | null,
): Promise<void> {
  const port = resolvePersistencePort(env);
  if (!port || !postgresReady(env)) return;
  if (!verified?.uid || !prep) return;

  // P0 fix (Sep 7): a missing companyDomain used to SILENTLY drop the entire
  // prep write (pre_call + activity never landed, no fallback log entry, no
  // user-visible error). Losing a generated brief is strictly worse than
  // provisioning a generic account, so we now always derive an account id:
  //   1. explicit input.accountId
  //   2. deterministic placeholder from companyDomain (dedupes re-synths)
  //   3. slugified companyName when the domain is absent
  //   4. last-resort generic placeholder keyed to the session user
  // and provision whatever we derived. A warn line keeps forensics possible.
  const companyDomain = nullableString(input.companyDomain);
  const companyName = nullableString(input.companyName);
  const explicitAccountId = nullableString(input.accountId);
  if (!companyDomain && !companyName && !explicitAccountId) {
    console.warn(
      "[prep] synthesize input has no companyDomain/companyName/accountId — using generic placeholder account",
    );
  }

  const session = await resolveSqlSession(verified.uid, env, verified.email);
  if (!session) {
    console.warn("[prep] no SQL session for uid (pre-migration user) — Firestore-only prep");
    return;
  }

  const outcome = await withSessionContext(session, async (client) => {
    // A synthesize call carries no owner/org, but the authenticated writer IS
    // the prep owner — resolve their public_id + org unit from app_user.
    const who = await client.query(
      `SELECT public_id, org_unit_id FROM app_user WHERE id = $1`,
      [session.userId],
    );
    const ownerId = stringField(who.rows[0]?.public_id);
    const orgUnitId = stringField(who.rows[0]?.org_unit_id);
    if (!ownerId || !orgUnitId) {
      console.warn("[prep] writer has no owner/org unit in SQL — skipping pre_call dual-write");
      return null;
    }

    // Explicit account when the client supplied one, else a deterministic
    // placeholder from the domain (or company name / generic fallback) so
    // repeated synths dedupe to one account instead of piling duplicates.
    const domainSlug =
      companyDomain?.replace(/[^a-z0-9]+/gi, "_").toLowerCase() ||
      companyName?.replace(/[^a-z0-9]+/gi, "_").toLowerCase() ||
      `unknown_${session.userId}`;
    const accountId =
      explicitAccountId ?? `acct_synth_${domainSlug}`;
    if (!explicitAccountId) {
      console.warn(
        `[prep] derived placeholder account ${accountId} (companyDomain=${companyDomain ?? "none"}, companyName=${companyName ?? "none"})`,
      );
    }
    await ensureAccountProvisioned(
      client,
      port,
      accountId,
      companyName || companyDomain || "Unknown Company",
      companyDomain,
    );

    // input_snapshot is shape-validated on allowed top-level keys — build it
    // from the request input, dropping compute-only fields (researchBundle,
    // cachedResearch payloads) that would trip the validator.
    const snapshot: Record<string, unknown> = {};
    for (const key of [
      "companyName", "companyDomain", "prospectEmail", "prospectEmails",
      "prospectName", "additionalContext", "ae", "effort", "prepType",
      "confirmedFacts", "confirmedProspectProfiles", "meetingType", "notes",
      "accountId", "dealId", "contactIds", "callId", "userId",
      "requestedAt", "requestedBy",
    ]) {
      if (input[key] !== undefined) snapshot[key] = input[key];
    }

    let briefShapeVersion: string;
    let snapshotShapeVersion: string;
    try {
      briefShapeVersion = validateJsonbShape("pre_call.research_brief", prep);
      snapshotShapeVersion = validateJsonbShape("pre_call.input_snapshot", snapshot);
    } catch (shapeErr) {
      console.warn(
        "[prep] pre_call shape validation failed, Firestore-only:",
        shapeErr instanceof Error ? shapeErr.message : shapeErr,
      );
      return null;
    }
    void briefShapeVersion;
    void snapshotShapeVersion;

    // Deterministic id per writer+company (unless the client passed a callId),
    // so a re-synthesized brief updates the same pre_call instead of duplicating.
    const prepId = nullableString(input.callId) ?? `prep_synth_${session.userId}_${domainSlug}`;
    const idempotencyKey = `prep_${prepId}`;
    const activityPublicId = `act_${prepId}`;
    // Fall back to lifecycleId like createPrepBrief's domain-write case does
    // (line ~2110) -- the client (web/precall.js) reliably sends lifecycleId,
    // not dealId, so dealId-only resolution left activity.deal_id null on
    // almost every real synthesize call. trg_pre_call_deal_required then
    // hard-rejected the write, silently swallowed by the outer try/catch in
    // handlePrepSynthesize -- pre_call essentially never landed.
    const dealRef = await ensureDealRef(
      client, port, nullableString(input.dealId) ?? nullableString(input.lifecycleId),
      accountId, ownerId, orgUnitId, stringField(input.companyName) || companyDomain || "Untitled deal",
    );
    await port.upsertActivity(client, {
      publicId: activityPublicId,
      idempotencyKey,
      dealPublicId: dealRef,
      accountPublicId: accountId,
      ownerPublicId: ownerId,
      orgUnitId,
      activityType: "meeting",
      subject: stringField(input.companyName) || companyDomain || "Prep",
      occurredAt: new Date().toISOString(),
    });
    await port.upsertPreCall(client, {
      publicId: prepId,
      idempotencyKey,
      activityPublicId,
      researchBrief: prep,
      inputSnapshot: snapshot,
    });
    // Success log emitted by the caller AFTER COMMIT (see tryHistoryPostCallSqlWrite).
    return { prepId, accountId, ownerId };
  }, env);
  if (outcome) {
    console.info(
      `[prep] dual-wrote pre_call ${outcome.prepId} → Postgres (account ${outcome.accountId}, owner ${outcome.ownerId})`,
    );
  }
}

function primaryTeamIdFromAccount(account: Record<string, unknown>, ownerId: string): string {
  const seTeam = Array.isArray(account.seTeam) ? account.seTeam : [];
  for (const member of seTeam) {
    if (!member || typeof member !== "object") continue;
    const row = member as Record<string, unknown>;
    if (stringField(row.seUserId) === ownerId) {
      return stringField(row.teamId);
    }
  }
  return stringField(account.teamId);
}

/**
 * Minimal shape of the two Firestore Admin SDK calls createDealIdempotent
 * needs. The real `Firestore` from firebase-admin satisfies this
 * structurally, and tests can drive the function against a small fake
 * instead — no live Firestore/emulator is available on this machine (no JDK;
 * see docs/janus-forensic-reaudit-20260911/08-security-privacy.md).
 */
interface DealsWriteDb {
  collection(name: string): {
    doc(id: string): {
      create(data: Record<string, unknown>): Promise<unknown>;
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    };
  };
}

export interface DealCreateInput {
  accountId: string;
  ownerId: string;
  teamId: string | null;
  orgId: string | null;
  type: string;
  title: string;
  primaryContactId: string | null;
  actorId: string;
  /** Injectable for tests; defaults to Date.now(). */
  now?: number;
}

/**
 * UAT-003 fix (2026-09-11 staging UAT: deal count observed going 4 -> 8 on
 * retry/reload). The old code always did
 * `db.collection("deals").add({ ...fields })` — `.add()` mints a random
 * auto-id on every call with no deduplication, so a client retry (network
 * timeout, a double-click past debounce, a proxy retry) for what the user
 * experiences as ONE "create deal" action produced a second, third, Nth
 * Firestore document.
 *
 * Firestore has no ON CONFLICT, but docRef.create() is the equivalent
 * primitive: it throws ALREADY_EXISTS (gRPC code 6) if a document already
 * exists at that id, whereas .set() would silently overwrite and .add()
 * always creates a new document regardless of content. So the id is derived
 * from CONTENT rather than minted, and .create() replaces .add().
 *
 * Same shape as this file's other deterministicAppendId callers
 * (addContactEvent, upsertArrOverride) and for the same reason documented
 * there: a pure content hash would also swallow a legitimate LATER
 * duplicate-content deal (e.g. the same account re-engaging with another
 * "New Business" deal months on), so the hash includes a coarse 5-minute
 * time bucket — a same-content create within the window is a retry, outside
 * it is a new event. Only fields that identify WHAT is being created are
 * hashed (accountId, ownerId, teamId, orgId, type, title, primaryContactId);
 * createdAt/updatedAt/lastActivityAt and the request-only actorId are
 * excluded because they either vary per attempt (timestamps) or don't
 * change what the deal fundamentally is.
 *
 * On ALREADY_EXISTS, the retry must look like SUCCESS to the caller, not a
 * new failure mode — so the existing document is read back and returned
 * with the same dealId instead of throwing.
 *
 * Exported for tests only.
 */
export async function createDealIdempotent(
  db: DealsWriteDb,
  input: DealCreateInput,
): Promise<{ dealId: string; ownerId: string }> {
  const { accountId, ownerId, teamId, orgId, type, title, primaryContactId, actorId } = input;
  const ts = input.now ?? Date.now();
  const dealId = deterministicAppendId(
    "deal",
    accountId,
    { accountId, ownerId, teamId, orgId, type, title, primaryContactId },
    ts,
  );

  const payload = {
    accountId,
    ownerId,
    teamId,
    orgId,
    type,
    stage: "research",
    status: "active",
    title,
    primaryContactId,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
    createdBy: actorId,
    createdVia: "postcall-dualwrite",
  };

  try {
    await db.collection("deals").doc(dealId).create(payload);
    return { dealId, ownerId };
  } catch (err) {
    // ALREADY_EXISTS: this exact content already produced a deal within the
    // current window — almost certainly the same logical create, retried.
    const code = (err as { code?: number | string } | null | undefined)?.code;
    if (code === 6 || code === "ALREADY_EXISTS") {
      const existing = await db.collection("deals").doc(dealId).get();
      if (existing.exists) {
        const data = existing.data() || {};
        return { dealId, ownerId: stringField(data.ownerId) || ownerId };
      }
    }
    throw err;
  }
}

/** POST /api/deals — server-side deal creation for post-call dual-write. */
export async function handleDealsCreate(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!firestoreAdminReady(env)) {
    return json({ error: "Firestore admin is not configured for server-side deal creation." }, 503, cors);
  }

  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  const ctx = await resolveRequestContext(verified, env);
  const body = (await request.json()) as Record<string, unknown>;
  const accountId = stringField(body.accountId);
  if (!accountId) {
    return json({ error: "accountId is required." }, 400, cors);
  }

  let account: Record<string, unknown> | null = null;
  if (persistenceReadReady(env)) {
    const session = await resolveSqlSession(verified.uid, env, verified.email);
    if (session) {
      const pool = await getPool(env);
      const repo = createPostgresReadRepository(pool, session, env);
      account = await repo.getAccount(accountId);
    }
  }
  if (!account) {
    account = await getDoc("accounts", accountId, env);
  }
  if (!account) {
    return json({ error: "Account not found." }, 404, cors);
  }

  // NEW-3 fix: verify the caller is authorized to create deals for this
  // account. The old code had no check — any authenticated user could
  // create deals on any account (IDOR). Mirrors Firestore canCreateAccount:
  // admin sees all, manager checks team/org, SE checks team.
  //
  // account.primarySeUserId below is a Firestore-doc field, never populated
  // for accounts created via the SQL path (see seatAccountSeTeamFromDoc) --
  // so this always failed for every SQL-era account regardless of who
  // actually owns it. Real ownership lives in account_se_team
  // (26_account_se_team.sql) now; defer to the exact RLS predicate the
  // updateAccount P0 fix already uses (account_writable_by_current_user:
  // admin, OR on the team, OR the account is unclaimed) before falling back
  // to the stale Firestore-field check.
  let authorized = ctx.role === "admin";
  if (!authorized && postgresReady(env)) {
    try {
      const session = await resolveSqlSession(verified.uid, env, verified.email);
      if (session) {
        // J-010, SECOND OCCURRENCE. This used to be one statement listing the
        // predicate BEFORE the setter:
        //
        //   SELECT account_writable_by_current_user(...) AS ok,
        //          set_config('app.user_id', $2, true) IS NOT NULL AS ctx_ok
        //
        // A target list is not evaluated top-to-bottom, and set_config(...,
        // is_local => true) is scoped to the transaction — here an implicit
        // single-statement one — so the predicate ran with no app.user_id and
        // current_user_id() was empty.
        //
        // It went unnoticed because it FAILS OPEN on an unclaimed account:
        // account_writable_by_current_user allows admin OR on-the-team OR
        // unclaimed, and the unclaimed branch needs no session. Measured on a
        // disposable cluster against a CLAIMED account (account_se_team row
        // present) with the legitimate owner's session:
        //
        //   this ordering    -> ok=true in 0/10 attempts
        //   correct ordering -> ok=true
        //
        // So an SE was denied on exactly the accounts they own, then fell
        // through to the assertCanReadResource check below on
        // account.primarySeUserId — which the comment above already records as
        // never populated for SQL-era accounts. Net effect: 403 "You are not
        // authorized to create deals for this account" for a legitimate owner.
        //
        // accountWritableBySession runs the predicate inside
        // withSessionContext, which issues BEGIN and the set_config as an
        // EARLIER statement, so the session variable is visible.
        authorized = await accountWritableBySession(session, accountId, env);
      }
    } catch (err) {
      console.warn(
        `[deals] account_writable_by_current_user check failed for ${accountId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (!authorized) {
    try {
      assertCanReadResource(ctx, {
        ownerId: stringField(account.primarySeUserId) || undefined,
        teamId: typeof account.teamId === "string" ? account.teamId : undefined,
        orgId: typeof account.orgId === "string" ? account.orgId : undefined,
      });
    } catch {
      return json({ error: "You are not authorized to create deals for this account." }, 403, cors);
    }
  }

  const actorId = ctx.userId;
  const ownerId = stringField(account.primarySeUserId) || actorId;
  const teamId = primaryTeamIdFromAccount(account, ownerId) || stringField(body.teamId);
  const orgId = nullableStringField(account.orgId) || nullableStringField(body.orgId);
  const type = stringField(body.type) === "expansion" ? "expansion" : "new_business";
  const title = stringField(body.title) || "Account";
  const primaryContactId = nullableStringField(body.primaryContactId);

  const db = await getDb(env);
  // UAT-003 fix — see createDealIdempotent's docstring: a retrying client no
  // longer mints a fresh Firestore document every attempt.
  const result = await createDealIdempotent(db, {
    accountId,
    ownerId,
    teamId,
    orgId,
    type,
    title,
    primaryContactId,
    actorId,
  });

  return json(result, 200, cors);
}

export const routes: Record<string, Record<string, RouteHandler>> = {
  // Domain read routes (Firestore list endpoints — /api/accounts, /api/calls, /api/deals GET).
  // The explicit /api/deals entry below shadows the spread's GET-only entry and
  // re-includes GET so both methods are served (previously the POST-only entry
  // shadowed the spread and GET /api/deals was unreachable).
  ...domainReadRoutes,
  ...healthRoutes,
  "/api/zoom/status": { GET: handleZoomStatus },
  "/api/config": { GET: handleConfig },
  "/api/zoom/auth": { GET: handleZoomAuth },
  "/api/history": { GET: handleHistoryGet, POST: handleHistoryPost },
  "/api/generate-prep": { POST: handleGeneratePrep },
  "/api/contact/enrich": { POST: handleContactEnrich },
  "/api/prep/research": { POST: handlePrepResearch },
  "/api/prep/synthesize": { POST: handlePrepSynthesize },
  "/api/fetch-transcript": { POST: handleFetchTranscript },
  "/api/kaia/share-content": { POST: handleKaiaShareContent },
  "/api/fetch-kaia-summary": { POST: handleFetchKaiaSummary },
  "/api/postcall/resolve": { POST: handlePostCallResolve },
  "/api/postcall/classify": { POST: handlePostCallClassify },
  "/api/postcall/generate": { POST: handlePostCallGenerate },
  "/api/postcall/summarise": { POST: handlePostCallSummarise },
  "/api/postcall/qualify": { POST: handlePostCallQualify },
  "/api/postcall/commit": { POST: handlePostCallCommit },
  "/api/postcall/arr-inputs": { POST: handlePostCallArrInputs },
  "/api/postcall/arr-compute": { POST: handlePostCallArrCompute },
  "/api/postcall/gaps": { POST: handlePostCallGaps },
  "/api/postcall/timeline": { POST: handlePostCallTimeline },
  "/api/product-signal/cluster": { POST: handleProductSignalCluster },
  "/api/postcall/summaries": { POST: handlePostCallSummaries },
  "/api/video-pass": { POST: handleVideoPass },
  "/api/analyze-call": { POST: handleAnalyzeCall },
  "/api/tasks": { GET: handleTasksGet, POST: handleTasksPost },
  "/api/feedback": { GET: handleFeedbackGet, POST: handleFeedbackPost },
  "/api/recovery/upload": { POST: handleRecoveryUpload },
  "/api/recovery/status": { GET: handleRecoveryStatus },
  "/api/deals": { GET: handleDealsListGet, POST: handleDealsCreate },
  "/api/domain-write": { POST: handleDomainWrite },
  "/api/tickets": { POST: handleTicketsPost },
  "/api/disputes/notify": { POST: handleDisputeNotifyPost },
  "/api/search/rag": { POST: handleSearchRag },
  "/api/org/structure": { GET: handleOrgStructureGet, PATCH: handleOrgStructurePatch },
  "/api/internal/outbox/project": { POST: handleOutboxProjectPost },
  "/api/internal/outbox/health": { GET: handleOutboxHealthGet },
  "/api/internal/usage/rollup": { POST: handleUsageRollupPost },
  "/api/read-models/schedule": { POST: handleReadModelsSchedulePost },
  "/api/internal/batch/enqueue": { POST: handleBatchEnqueuePost },
  "/api/internal/batch/poll": { POST: handleBatchPollPost },
  "/api/internal/batch/fallback": { POST: handleBatchFallbackPost },
  "/api/internal/read-models/nightly-rebuild": { POST: handleReadModelsNightlyRebuildPost },
  "/api/internal/deal-grace-sweep": { POST: handleDealGraceSweepPost },
  "/api/admin/llm-usage": { GET: handleAdminLlmUsageGet },
  // "/api/analytics/director-summary" is intentionally left UNREGISTERED.
  //
  // The Astra branch registered it along with the other dead routes, but
  // handleDirectorAnalyticsGet only calls requireUser -- it has no role check
  // and no org filter, and queryDirectorCallVolume aggregates
  // `<dataset>.callSummaries_raw_*` with no tenant predicate. Registering it
  // would let ANY authenticated SE read org-wide call volume, which is a
  // tenant-isolation regression; contrast /api/admin/llm-usage above, which
  // resolves request context and 403s anything below director scope.
  //
  // Nothing calls this endpoint (no caller in web/ or worker/ on either
  // branch), so leaving it unregistered loses no functionality -- unlike
  // /api/read-models/schedule above, which web/domain/read-models-service.js
  // already calls and which was 404ing until it was registered.
  //
  // To enable it: gate it on director/admin scope the way admin-llm-usage.ts
  // does and add an org predicate to the BigQuery query, then register it.
};
