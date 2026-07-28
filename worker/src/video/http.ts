/**
 * Node-only HTTP helpers for Pass 2. Imported from node-server, not the CF Worker graph.
 */

import { buildVideoFactsDraft } from "./facts";
import { runVideoPass, type VideoPassEnv } from "./pass2";
import type { ZoomShareMedia } from "../zoomShare";

export interface VideoPassRequestBody {
  callId?: string;
  recordingUrl?: string;
  recordingPassword?: string;
  media?: ZoomShareMedia;
  transcript?: string;
  durationSec?: number | null;
  callType?: string | null;
  visualAnalysisConsent?: boolean;
  skipVision?: boolean;
}

export async function handleVideoPassNode(
  body: VideoPassRequestBody,
  env: VideoPassEnv,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const callId = body.callId?.trim();
  if (!callId) {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "callId is required.",
        videoFacts: buildVideoFactsDraft({
          status: "unavailable",
          samples: [],
          errorMessage: "callId is required",
        }),
      },
    };
  }

  const result = await runVideoPass(env, {
    callId,
    media: body.media,
    recordingUrl: body.recordingUrl,
    recordingPassword: body.recordingPassword,
    transcript: body.transcript,
    durationSec: body.durationSec,
    callType: body.callType,
    visualAnalysisConsent: !!body.visualAnalysisConsent,
    skipVision: !!body.skipVision,
  });

  return {
    status: 200,
    payload: {
      ok: result.ok,
      unavailable: result.unavailable,
      reason: result.reason,
      videoFacts: result.videoFacts,
    },
  };
}
