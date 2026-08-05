/**
 * Pass 2 orchestrator — Zoom media stream → samples → videoFacts draft,
 * with Gemini transcript inference when ffmpeg is unavailable or fails.
 */

import type { VideoFactsDraft } from "../domain-model/video-facts";
import type { ProviderEnv } from "../providers/types";
import {
  fetchRecordingFromShareLink,
  preferredMediaStream,
  type ZoomMediaStreamKind,
  type ZoomShareMedia,
} from "../zoomShare";
import { ffmpegAvailable, isNodeRuntime, videoPassReady } from "./capability";
import { buildVideoFactsDraft, DEFAULT_SAMPLE_INTERVAL_S, pickVisionKeyframes } from "./facts";
import { cleanupStaging, sampleStrategicWindowsFromUrl } from "./ffmpeg";
import { mergeAttendeeCurveTalk } from "./sampling";
import { inferVideoFactsFromTranscript } from "./transcript-infer";
import { analyzeKeyframes } from "./vision";

export interface VideoPassEnv extends ProviderEnv {
  VIDEO_PASS_ENABLED?: string;
}

export interface VideoPassInput {
  callId: string;
  /** Prefer passing media from Pass 0 to avoid a second Zoom round-trip. */
  media?: ZoomShareMedia;
  recordingUrl?: string;
  recordingPassword?: string;
  /** VTT or plain transcript — enables Gemini Pass 2 without ffmpeg. */
  transcript?: string;
  durationSec?: number | null;
  callType?: string | null;
  /** Spec §12.8 — required for face/camera vision. */
  visualAnalysisConsent?: boolean;
  /** Skip Gemini vision (tests / offline). */
  skipVision?: boolean;
  /** Per-call opt-in — when false, skip Pass 2 entirely. */
  enableVideoPass?: boolean;
  seIdentity?: string | null;
  aeIdentity?: string | null;
  customerIdentities?: string[] | null;
  userId?: string;
}

export interface VideoPassResult {
  ok: boolean;
  unavailable?: boolean;
  reason?: string;
  videoFacts: VideoFactsDraft;
  pass2Debug?: Pass2Debug;
}

export interface Pass2Debug {
  route: "ffmpeg" | "transcript" | "unavailable";
  ffmpegOk?: boolean;
  consent?: boolean;
  hasStream?: boolean;
  hasRecordingUrl?: boolean;
  hasCookie?: boolean;
  streamKind?: string | null;
  sampleCount?: number;
  keyframeCount?: number;
  visionCurveRows?: number;
  mergedTalk?: boolean;
  freshMedia?: boolean;
  /** Why transcript route was chosen over ffmpeg vision (for UI / ops). */
  fallbackReason?: string;
}

function curveHasCameraData(
  curve: VideoFactsDraft["attendeeCurveJson"] | null | undefined,
): boolean {
  if (!Array.isArray(curve)) return false;
  return curve.some(
    (p) =>
      p?.cameraOn === true ||
      p?.cameraOn === false ||
      (p?.cameraOnPct != null && Number.isFinite(Number(p.cameraOnPct))),
  );
}

function seedCurveFromTopLevelCamera(
  cameraOnPct: number | null | undefined,
  input: VideoPassInput,
): VideoFactsDraft["attendeeCurveJson"] {
  if (cameraOnPct == null || !Number.isFinite(Number(cameraOnPct)) || !input.seIdentity?.trim()) {
    return null;
  }
  const pct = Math.max(0, Math.min(100, Math.round(Number(cameraOnPct))));
  return [
    {
      name: input.seIdentity.trim(),
      role: "se",
      talkPct: null,
      cameraOn: pct >= 50,
      cameraOnPct: pct,
    },
  ];
}

function unavailableDraft(reason: string, streamKind?: string | null): VideoFactsDraft {
  return buildVideoFactsDraft({
    status: "unavailable",
    samples: [],
    streamKind,
    errorMessage: reason,
  });
}

/** Without face consent, prefer share-only stream to reduce face pixels stored. */
function pickStreamForConsent(
  media: ZoomShareMedia | undefined,
  consent: boolean,
): { kind: ZoomMediaStreamKind; url: string } | undefined {
  if (!media?.streams?.length) return undefined;
  if (!consent) {
    const share = media.streams.find((s) => s.kind === "share");
    if (share) return share;
    return preferredMediaStream(media);
  }
  // Face/camera vision needs the gallery view — not share-only (no participant tiles).
  const cameraStream =
    media.streams.find((s) => s.kind === "view") ||
    media.streams.find((s) => s.kind === "view_with_share");
  if (cameraStream) return cameraStream;
  return preferredMediaStream(media);
}

/** Prefer a fresh Zoom fetch at Pass 2 time — share-link URLs from Pass 0 expire during the confirm gate. */
async function resolvePass2Media(input: VideoPassInput): Promise<ZoomShareMedia | undefined> {
  if (input.recordingUrl?.trim()) {
    try {
      const fetched = await fetchRecordingFromShareLink(
        input.recordingUrl.trim(),
        input.recordingPassword?.trim(),
      );
      if (fetched.media?.streams?.length) return fetched.media;
    } catch (err) {
      console.warn(
        "[video/pass2] fresh media fetch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return input.media;
}

async function enrichFfmpegWithTranscriptTalk(
  env: VideoPassEnv,
  input: VideoPassInput,
  result: VideoPassResult,
): Promise<VideoPassResult> {
  if (!result.ok || !input.transcript?.trim()) return result;
  try {
    let cameraRows = result.videoFacts.attendeeCurveJson;
    if (!curveHasCameraData(cameraRows)) {
      const seeded = seedCurveFromTopLevelCamera(result.videoFacts.cameraOnPct, input);
      if (seeded?.length) cameraRows = seeded;
    }
    const talkDraft = await inferVideoFactsFromTranscript(env, {
      transcript: input.transcript,
      durationSec: input.durationSec ?? input.media?.durationSec ?? null,
      callType: input.callType,
      visualAnalysisConsent: input.visualAnalysisConsent,
      userId: input.userId,
      callId: input.callId,
    });
    if (talkDraft.status !== "ready" || !talkDraft.attendeeCurveJson) {
      if (cameraRows?.length && !result.videoFacts.attendeeCurveJson?.length) {
        return {
          ...result,
          videoFacts: { ...result.videoFacts, attendeeCurveJson: cameraRows },
          pass2Debug: { ...(result.pass2Debug || { route: "ffmpeg" }), mergedTalk: false },
        };
      }
      return result;
    }
    const merged = mergeAttendeeCurveTalk(cameraRows, talkDraft.attendeeCurveJson, {
      seIdentity: input.seIdentity,
      aeIdentity: input.aeIdentity,
      customerIdentities: input.customerIdentities,
    });
    let finalCurve = merged;
    if (finalCurve?.length && !curveHasCameraData(finalCurve) && result.videoFacts.cameraOnPct != null) {
      const seeded = seedCurveFromTopLevelCamera(result.videoFacts.cameraOnPct, input);
      if (seeded?.length) {
        finalCurve = mergeAttendeeCurveTalk(seeded, talkDraft.attendeeCurveJson, {
          seIdentity: input.seIdentity,
          aeIdentity: input.aeIdentity,
          customerIdentities: input.customerIdentities,
        });
      }
    }
    if (!finalCurve?.length) return result;
    return {
      ...result,
      videoFacts: { ...result.videoFacts, attendeeCurveJson: finalCurve },
      pass2Debug: { ...(result.pass2Debug || { route: "ffmpeg" }), mergedTalk: true },
    };
  } catch (err) {
    console.warn(
      "[video/pass2] transcript talk merge failed:",
      err instanceof Error ? err.message : err,
    );
    return result;
  }
}

async function runTranscriptPass(
  env: VideoPassEnv,
  input: VideoPassInput,
): Promise<VideoPassResult> {
  const draft = await inferVideoFactsFromTranscript(env, {
    transcript: input.transcript || "",
    durationSec: input.durationSec ?? input.media?.durationSec ?? null,
    callType: input.callType,
    visualAnalysisConsent: input.visualAnalysisConsent,
    userId: input.userId,
    callId: input.callId,
  });
  if (draft.status === "ready") {
    const consent = !!input.visualAnalysisConsent;
    let videoFacts = draft;
    if (consent && draft.streamKind === "transcript_infer") {
      const hint = "ffmpeg/vision unavailable — camera not scored from video frames";
      videoFacts = {
        ...draft,
        errorMessage: draft.errorMessage?.trim()
          ? `${draft.errorMessage} (${hint})`
          : hint,
      };
    }
    return {
      ok: true,
      videoFacts,
      pass2Debug: { route: "transcript", visionCurveRows: draft.attendeeCurveJson?.length ?? 0 },
    };
  }
  if (draft.status === "unavailable") {
    return {
      ok: false,
      unavailable: true,
      reason: draft.errorMessage || "Pass 2 unavailable",
      videoFacts: draft,
    };
  }
  return { ok: false, videoFacts: draft };
}

async function runFfmpegPass(
  env: VideoPassEnv,
  input: VideoPassInput,
  media: ZoomShareMedia,
  stream: { kind: ZoomMediaStreamKind; url: string },
  consent: boolean,
): Promise<VideoPassResult> {
  const callId = input.callId.trim();
  const durationSec = media.durationSec ?? input.durationSec ?? null;
  try {
    const { samples } = await sampleStrategicWindowsFromUrl({
      callId,
      mediaUrl: stream.url,
      referer: media.referer,
      authHeader: media.authHeader,
      cookieHeader: media.cookieHeader,
      durationSec: durationSec ?? undefined,
      sampleIntervalS: DEFAULT_SAMPLE_INTERVAL_S,
    });

    if (!samples.length) {
      await cleanupStaging(callId);
      return {
        ok: false,
        videoFacts: buildVideoFactsDraft({
          status: "failed",
          samples: [],
          durationSec: media.durationSec,
          streamKind: stream.kind,
          errorMessage: "ffmpeg produced no frames",
          visualAnalysisConsent: consent,
        }),
      };
    }

    const keyframeSamples = pickVisionKeyframes(samples);
    let cameraOnPct: number | null = null;
    let cdeCustomized: boolean | null = null;
    let cdeEvidence: string | null = null;
    let shareOnPct: number | null = null;
    let attendeeCurveJson: VideoFactsDraft["attendeeCurveJson"] = null;
    let extraSegments: VideoFactsDraft["segments"] = [];

    if (!input.skipVision) {
      const vision = await analyzeKeyframes(env, keyframeSamples, {
        visualAnalysisConsent: consent,
        identities: {
          seIdentity: input.seIdentity,
          aeIdentity: input.aeIdentity,
          customerIdentities: input.customerIdentities,
        },
        durationSec: durationSec ?? media.durationSec,
        userId: input.userId,
        callId: input.callId,
      });
      cameraOnPct = vision.cameraOnPct;
      cdeCustomized = vision.cdeCustomized;
      cdeEvidence = vision.cdeEvidence;
      shareOnPct = vision.shareOnPct;
      attendeeCurveJson = vision.attendeeCurveJson ?? null;
      extraSegments = vision.pptSegments ?? [];
      if (consent && !attendeeCurveJson?.length) {
        attendeeCurveJson = seedCurveFromTopLevelCamera(cameraOnPct, input);
      }
    }

    await cleanupStaging(callId);

    const draft = buildVideoFactsDraft({
      status: "ready",
      samples,
      durationSec: media.durationSec ?? samples[samples.length - 1]?.atS,
      streamKind: stream.kind,
      cameraOnPct,
      cdeCustomized,
      cdeEvidence,
      shareOnPct,
      visualAnalysisConsent: consent,
      attendeeCurveJson,
      segments: extraSegments.length ? extraSegments : undefined,
      sampleIntervalS: 3,
    });

    return {
      ok: true,
      videoFacts: draft,
      pass2Debug: {
        route: "ffmpeg",
        sampleCount: samples.length,
        keyframeCount: keyframeSamples.length,
        visionCurveRows: draft.attendeeCurveJson?.length ?? 0,
      },
    };
  } catch (err) {
    await cleanupStaging(callId).catch(() => {});
    const msg = err instanceof Error ? err.message : "Pass 2 ffmpeg failed";
    return {
      ok: false,
      videoFacts: buildVideoFactsDraft({
        status: "failed",
        samples: [],
        durationSec: media.durationSec,
        streamKind: stream.kind,
        errorMessage: msg.slice(0, 500),
        visualAnalysisConsent: consent,
      }),
    };
  }
}

export async function runVideoPass(
  env: VideoPassEnv,
  input: VideoPassInput,
): Promise<VideoPassResult> {
  const callId = input.callId?.trim();
  if (!callId) {
    return {
      ok: false,
      unavailable: true,
      reason: "callId is required",
      videoFacts: unavailableDraft("callId is required"),
    };
  }

  if (input.enableVideoPass === false) {
    return {
      ok: false,
      unavailable: true,
      reason: "Video pass not requested for this call",
      videoFacts: unavailableDraft("Video pass not requested"),
      pass2Debug: { route: "unavailable" },
    };
  }

  const cap = await videoPassReady(env);
  const hasRecordingUrl = !!input.recordingUrl?.trim();
  if (!cap.ready) {
    // Zoom recording + face consent needs ffmpeg on VPS — do not silently downgrade to transcript.
    if (hasRecordingUrl && !!input.visualAnalysisConsent) {
      const reason =
        cap.reason ||
        "Pass 2 video unavailable — enable VIDEO_PASS_ENABLED and ffmpeg on the VPS worker";
      return {
        ok: false,
        unavailable: true,
        reason,
        videoFacts: unavailableDraft(reason),
        pass2Debug: {
          route: "unavailable",
          ffmpegOk: false,
          consent: true,
          hasRecordingUrl: true,
          fallbackReason: reason,
        },
      };
    }
    if (input.transcript?.trim()) {
      return runTranscriptPass(env, input);
    }
    return {
      ok: false,
      unavailable: true,
      reason: cap.reason,
      videoFacts: unavailableDraft(cap.reason || "Pass 2 unavailable"),
    };
  }

  const consent = !!input.visualAnalysisConsent;
  const hadCachedMedia = !!input.media?.streams?.length;
  let media = await resolvePass2Media(input);
  const freshMedia = !!media?.streams?.length && !hadCachedMedia;
  if (!media?.streams?.length && input.recordingUrl?.trim()) {
    return {
      ok: false,
      unavailable: true,
      reason: "Zoom media resolve failed",
      videoFacts: unavailableDraft("Zoom media resolve failed — could not fetch recording streams"),
    };
  }

  const stream = pickStreamForConsent(media, consent);
  const ffmpegOk = isNodeRuntime() && (await ffmpegAvailable());

  console.info("[video/pass2] route", {
    callId,
    consent,
    ffmpegOk,
    capMode: cap.mode,
    hasStream: !!stream,
    hasTranscript: !!input.transcript?.trim(),
    freshMedia,
  });

  const baseDebug: Pass2Debug = {
    route: stream && ffmpegOk ? "ffmpeg" : input.transcript?.trim() ? "transcript" : "unavailable",
    ffmpegOk,
    consent,
    hasStream: !!stream,
    hasRecordingUrl,
    hasCookie: !!media?.cookieHeader?.trim(),
    streamKind: stream?.kind ?? null,
    freshMedia,
  };

  // Without face consent, transcript inference is faster and sufficient for PPT/share segments.
  if (!consent && input.transcript?.trim()) {
    const r = await runTranscriptPass(env, input);
    return { ...r, pass2Debug: { ...baseDebug, route: "transcript", ...(r.pass2Debug || {}) } };
  }

  if (stream && ffmpegOk) {
    let ffmpegResult = await runFfmpegPass(env, input, media!, stream, consent);
    // Post-call confirm does not pass Pass 0 media (signed URLs expire) — always refresh on failure.
    if (!ffmpegResult.ok && hasRecordingUrl) {
      const refreshed = await resolvePass2Media({
        ...input,
        media: undefined,
      });
      if (refreshed?.streams?.length) {
        const retryStream = pickStreamForConsent(refreshed, consent);
        if (retryStream) {
          console.warn("[video/pass2] retrying ffmpeg with refreshed Zoom media URLs");
          ffmpegResult = await runFfmpegPass(env, input, refreshed, retryStream, consent);
        }
      }
    }
    if (ffmpegResult.ok) {
      const enriched = await enrichFfmpegWithTranscriptTalk(env, input, ffmpegResult);
      return {
        ...enriched,
        pass2Debug: { ...baseDebug, ...(enriched.pass2Debug || {}), route: "ffmpeg" },
      };
    }
    console.warn("[video/pass2] ffmpeg failed; consent=", consent, ffmpegResult.videoFacts.errorMessage);
    if (input.transcript?.trim()) {
      const fallback = await runTranscriptPass(env, input);
      if (fallback.ok) {
        if (consent) {
          console.warn(
            "[video/pass2] visual consent set but ffmpeg failed — camera from transcript only (no frames)",
          );
        }
        const ffErr = ffmpegResult.videoFacts.errorMessage?.trim();
        const fallbackReason = ffErr
          ? `ffmpeg failed: ${ffErr.slice(0, 500)}`
          : "ffmpeg produced no usable frames";
        return {
          ...fallback,
          videoFacts: {
            ...fallback.videoFacts,
            errorMessage: ffErr
              ? `Pass 2 used transcript fallback (${fallbackReason})`
              : fallback.videoFacts.errorMessage,
          },
          pass2Debug: {
            ...baseDebug,
            route: "transcript",
            fallbackReason,
            ...(fallback.pass2Debug || {}),
          },
        };
      }
      return ffmpegResult;
    }
    return ffmpegResult;
  }

  if (input.transcript?.trim()) {
    const fallbackReason = !ffmpegOk
      ? hasRecordingUrl
        ? "ffmpeg not available on API server — check /api/config videoPass.ffmpeg on VPS"
        : "ffmpeg not available on this runtime"
      : !stream
        ? "no Zoom media stream resolved"
        : undefined;
    if (consent && stream && !ffmpegOk) {
      console.warn(
        "[video/pass2] visual consent set but ffmpeg unavailable on this runtime — transcript fallback",
        fallbackReason,
      );
    }
    const r = await runTranscriptPass(env, input);
    return {
      ...r,
      pass2Debug: {
        ...baseDebug,
        route: "transcript",
        fallbackReason,
        ...(r.pass2Debug || {}),
      },
    };
  }

  if (!stream) {
    return {
      ok: false,
      unavailable: true,
      reason: "No Zoom media streams and no transcript for Pass 2",
      videoFacts: unavailableDraft(
        "No Zoom media streams — provide a transcript for Gemini Pass 2 inference",
      ),
    };
  }

  return {
    ok: false,
    unavailable: true,
    reason: cap.reason || "Pass 2 unavailable (need GEMINI_API_KEY or ffmpeg)",
    videoFacts: unavailableDraft(cap.reason || "Pass 2 unavailable"),
  };
}
