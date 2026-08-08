import { requireUser, resolveHistoryEmail, resolveHistoryEmailForWrite, assertManagerProxyOwnerEmail } from "./auth";
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
  type PostCallSummariseInput,
  type PostCallQualifyInput,
  type PostCallCommitInput,
  type PostCallSummariesInput,
  type PostCallArrInputsInput,
  type PostCallArrComputeInput,
  type PostCallGapsInput,
} from "./postcall/index";
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
import { zoomAuthUrl, zoomConfigured } from "./zoom";
import { ffmpegAvailable, isNodeRuntime, videoPassEnvEnabled } from "./video/capability";
import { WORKER_BUILD, GEMINI_SCHEMA_ENUM_FIX } from "./build-id";
import { firestoreAdminReady, getDb, getDoc } from "./data/firestore-admin";
import { resolveRequestContext } from "./data/scope";
import { handleOrgStructureGet, handleOrgStructurePatch } from "./org-structure";
import { rerankWithEmbeddings, type RagCandidate } from "./search/rag-search";
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
  return json({ configured: zoomConfigured(env) }, 200, cors);
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
      zoom: { configured: zoomConfigured(env) },
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
  await requireUser(request, env);
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
  return json(
    {
      prep: result.prep,
      researchMeta: result.researchMeta,
      researchBundle: result.researchBundle,
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

export async function handlePostCallResolve(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const input = (await request.json()) as Partial<PostCallResolveInput>;
  await assertManagerProxyOwnerEmail(request, env, input.ownerEmail);
  if (!input.transcript?.trim() && !input.recordingUrl?.trim()) {
    return json(
      { error: "Paste a transcript or a Zoom/Kaia recording link (with passcode if needed)." },
      400,
      cors,
    );
  }
  try {
    const result = await runPostCallResolve(input as PostCallResolveInput, { zoomEnv: env });
    return json(result, 200, cors);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
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
  await requireUser(request, env);
  const input = (await request.json()) as Partial<
    PostCallGenerateInput & PostCallResolveInput & { confirmed?: boolean }
  >;
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
  const entries = await appendFeedback(env, email, entry);
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
  return json({ email, entry: body.entry, count: entries.length }, 200, cors);
}

/** POST /api/search/rag — embedding rerank for portal omni-search. */
export async function handleSearchRag(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const body = (await request.json()) as { query?: string; candidates?: RagCandidate[] };
  const query = String(body.query || "").trim();
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (!query) {
    return json({ error: "query is required." }, 400, cors);
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

  const account = await getDoc("accounts", accountId, env);
  if (!account) {
    return json({ error: "Account not found." }, 404, cors);
  }

  const actorId = ctx.userId;
  const ownerId = stringField(account.primarySeUserId) || actorId;
  const teamId = primaryTeamIdFromAccount(account, ownerId) || stringField(body.teamId);
  const orgId = nullableStringField(account.orgId) || nullableStringField(body.orgId);
  const type = stringField(body.type) === "expansion" ? "expansion" : "new_business";
  const title = stringField(body.title) || "Account";
  const primaryContactId = nullableStringField(body.primaryContactId);
  const ts = Date.now();

  const db = await getDb(env);
  const ref = await db.collection("deals").add({
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
  });

  return json({ dealId: ref.id, ownerId }, 200, cors);
}

export const routes: Record<string, Record<string, RouteHandler>> = {
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
  "/api/deals": { POST: handleDealsCreate },
  "/api/tickets": { POST: handleTicketsPost },
  "/api/disputes/notify": { POST: handleDisputeNotifyPost },
  "/api/search/rag": { POST: handleSearchRag },
  "/api/org/structure": { GET: handleOrgStructureGet, PATCH: handleOrgStructurePatch },
};
