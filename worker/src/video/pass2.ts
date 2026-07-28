/**
 * Pass 2 orchestrator — Zoom media stream → samples → videoFacts draft.
 * Kaia public share has no mp4 (see kaia/media.ts probe).
 */

import type { VideoFactsDraft } from "../domain-model/video-facts";
import type { ProviderEnv } from "../providers/types";
import {
  fetchRecordingFromShareLink,
  preferredMediaStream,
  type ZoomMediaStreamKind,
  type ZoomShareMedia,
} from "../zoomShare";
import { videoPassReady } from "./capability";
import { buildVideoFactsDraft, DEFAULT_SAMPLE_INTERVAL_S, pickKeyframes } from "./facts";
import { cleanupStaging, sampleFramesFromUrl } from "./ffmpeg";
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
  if (!stream) {
    return {
      ok: false,
      unavailable: true,
      reason: "No Zoom media streams (Kaia/transcript-only cannot run Pass 2)",
      videoFacts: unavailableDraft(
        "No Zoom media streams — Kaia public share links do not expose mp4 URLs",
      ),
    };
  }

  try {
    const { samples } = await sampleFramesFromUrl({
      callId,
      mediaUrl: stream.url,
      referer: media!.referer,
      authHeader: media!.authHeader,
      durationSec: media?.durationSec,
      sampleIntervalS: DEFAULT_SAMPLE_INTERVAL_S,
    });

    if (!samples.length) {
      await cleanupStaging(callId);
      return {
        ok: false,
        videoFacts: buildVideoFactsDraft({
          status: "failed",
          samples: [],
          durationSec: media?.durationSec,
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
      durationSec: media?.durationSec ?? samples[samples.length - 1]?.atS,
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
    const msg = err instanceof Error ? err.message : "Pass 2 failed";
    return {
      ok: false,
      videoFacts: buildVideoFactsDraft({
        status: "failed",
        samples: [],
        durationSec: media?.durationSec,
        streamKind: stream.kind,
        errorMessage: msg.slice(0, 500),
        visualAnalysisConsent: consent,
      }),
    };
  }
}
