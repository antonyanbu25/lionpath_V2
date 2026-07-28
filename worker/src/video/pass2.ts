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
import { ffmpegAvailable, videoPassReady } from "./capability";
import { buildVideoFactsDraft, DEFAULT_SAMPLE_INTERVAL_S, pickKeyframes } from "./facts";
import { cleanupStaging, sampleFramesFromUrl } from "./ffmpeg";
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
}

export interface VideoPassResult {
  ok: boolean;
  unavailable?: boolean;
  reason?: string;
  videoFacts: VideoFactsDraft;
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
  }
  return preferredMediaStream(media);
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
  });
  if (draft.status === "ready") {
    return { ok: true, videoFacts: draft };
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
  try {
    const { samples } = await sampleFramesFromUrl({
      callId,
      mediaUrl: stream.url,
      referer: media.referer,
      authHeader: media.authHeader,
      durationSec: media.durationSec,
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

    const keyframeSamples = pickKeyframes(samples);
    let cameraOnPct: number | null = null;
    let cdeCustomized: boolean | null = null;
    let cdeEvidence: string | null = null;
    let shareOnPct: number | null = null;

    if (!input.skipVision) {
      const vision = await analyzeKeyframes(env, keyframeSamples, {
        visualAnalysisConsent: consent,
      });
      cameraOnPct = vision.cameraOnPct;
      cdeCustomized = vision.cdeCustomized;
      cdeEvidence = vision.cdeEvidence;
      shareOnPct = vision.shareOnPct;
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
    });

    return { ok: true, videoFacts: draft };
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

  const cap = await videoPassReady(env);
  if (!cap.ready) {
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
  let media = input.media;
  if (!media?.streams?.length && input.recordingUrl?.trim()) {
    try {
      const fetched = await fetchRecordingFromShareLink(
        input.recordingUrl.trim(),
        input.recordingPassword?.trim(),
      );
      media = fetched.media;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Zoom media resolve failed";
      if (input.transcript?.trim()) {
        const fallback = await runTranscriptPass(env, input);
        if (fallback.ok) return fallback;
      }
      return {
        ok: false,
        videoFacts: buildVideoFactsDraft({
          status: "failed",
          samples: [],
          errorMessage: msg,
          visualAnalysisConsent: consent,
        }),
      };
    }
  }

  const stream = pickStreamForConsent(media, consent);
  const ffmpegOk = cap.mode === "ffmpeg" && (await ffmpegAvailable());

  if (stream && ffmpegOk) {
    const ffmpegResult = await runFfmpegPass(env, input, media!, stream, consent);
    if (ffmpegResult.ok) return ffmpegResult;
    if (input.transcript?.trim()) {
      const fallback = await runTranscriptPass(env, input);
      if (fallback.ok) return fallback;
      return ffmpegResult;
    }
    return ffmpegResult;
  }

  if (input.transcript?.trim()) {
    return runTranscriptPass(env, input);
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
