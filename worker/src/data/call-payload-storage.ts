/**
 * GCS storage for large postCall analysis / transcript payloads.
 */

import type { FirestoreEnv } from "./firestore-admin";

const DEFAULT_BUCKET = "se-singha-paathi-call-payloads";
export const PAYLOAD_OFFLOAD_THRESHOLD_BYTES = 200 * 1024;
export const DETAIL_SPILL_THRESHOLD_BYTES = 700 * 1024;

function bucketName(env?: FirestoreEnv): string {
  return (
    (env as { CALL_PAYLOAD_BUCKET?: string } | undefined)?.CALL_PAYLOAD_BUCKET ||
    process.env.CALL_PAYLOAD_BUCKET ||
    DEFAULT_BUCKET
  );
}

async function getStorage() {
  const mod = await import("@google-cloud/storage");
  return mod.default ?? mod;
}

function analysisObjectPath(callId: string): string {
  return `calls/${callId}/analysis.json`;
}

function transcriptObjectPath(callId: string): string {
  return `calls/${callId}/transcript-meta.json`;
}

function detailObjectPath(callId: string): string {
  return `calls/${callId}/detail.json`;
}

function gsUri(bucket: string, objectPath: string): string {
  return `gs://${bucket}/${objectPath}`;
}

/** @param {unknown} value */
export function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

export async function uploadCallPayload(
  callId: string,
  payload: { analysis?: unknown; transcriptMeta?: unknown; detail?: unknown },
  env?: FirestoreEnv,
): Promise<{
  analysisGcsUri: string | null;
  analysisByteSize: number | null;
  transcriptMetaGcsUri: string | null;
  transcriptMetaByteSize: number | null;
  detailGcsUri: string | null;
  detailByteSize: number | null;
}> {
  const bucket = bucketName(env);
  const storage = await getStorage();
  const b = storage.bucket(bucket);

  const analysisBytes = jsonByteSize(payload.analysis);
  const transcriptBytes = jsonByteSize(payload.transcriptMeta);
  const detailBytes = jsonByteSize(payload.detail);

  let analysisGcsUri: string | null = null;
  let transcriptMetaGcsUri: string | null = null;
  let detailGcsUri: string | null = null;

  if (analysisBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES) {
    const path = analysisObjectPath(callId);
    await b.file(path).save(JSON.stringify(payload.analysis ?? {}), {
      contentType: "application/json",
      metadata: { callId },
    });
    analysisGcsUri = gsUri(bucket, path);
  }

  if (transcriptBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES) {
    const path = transcriptObjectPath(callId);
    await b.file(path).save(JSON.stringify(payload.transcriptMeta ?? null), {
      contentType: "application/json",
      metadata: { callId },
    });
    transcriptMetaGcsUri = gsUri(bucket, path);
  }

  if (detailBytes > DETAIL_SPILL_THRESHOLD_BYTES) {
    const path = detailObjectPath(callId);
    await b.file(path).save(JSON.stringify(payload.detail ?? {}), {
      contentType: "application/json",
      metadata: { callId },
    });
    detailGcsUri = gsUri(bucket, path);
  }

  return {
    analysisGcsUri,
    analysisByteSize: analysisBytes || null,
    transcriptMetaGcsUri,
    transcriptMetaByteSize: transcriptBytes || null,
    detailGcsUri,
    detailByteSize: detailBytes || null,
  };
}

export async function downloadCallPayload(
  postCall: Record<string, unknown>,
  env?: FirestoreEnv,
): Promise<{ analysis?: unknown; transcriptMeta?: unknown; detail?: unknown }> {
  const bucket = bucketName(env);
  const storage = await getStorage();
  const b = storage.bucket(bucket);
  const out: { analysis?: unknown; transcriptMeta?: unknown; detail?: unknown } = {};

  const analysisUri = typeof postCall.analysisGcsUri === "string" ? postCall.analysisGcsUri : null;
  const transcriptUri =
    typeof postCall.transcriptMetaGcsUri === "string" ? postCall.transcriptMetaGcsUri : null;
  const detailUri = typeof postCall.detailGcsUri === "string" ? postCall.detailGcsUri : null;

  if (analysisUri?.startsWith(`gs://${bucket}/`)) {
    const path = analysisUri.slice(`gs://${bucket}/`.length);
    const [buf] = await b.file(path).download();
    out.analysis = JSON.parse(buf.toString("utf8"));
  }

  if (transcriptUri?.startsWith(`gs://${bucket}/`)) {
    const path = transcriptUri.slice(`gs://${bucket}/`.length);
    const [buf] = await b.file(path).download();
    out.transcriptMeta = JSON.parse(buf.toString("utf8"));
  }

  if (detailUri?.startsWith(`gs://${bucket}/`)) {
    const path = detailUri.slice(`gs://${bucket}/`.length);
    const [buf] = await b.file(path).download();
    out.detail = JSON.parse(buf.toString("utf8"));
  }

  return out;
}

export async function hydratePostCallDoc(
  postCall: Record<string, unknown>,
  env?: FirestoreEnv,
): Promise<Record<string, unknown>> {
  const hasInlineAnalysis = postCall.analysis && Object.keys(postCall.analysis as object).length > 0;
  const hasInlineTranscript = !!postCall.transcriptMeta;
  const needsAnalysis = postCall.analysisGcsUri && !hasInlineAnalysis;
  const needsTranscript = postCall.transcriptMetaGcsUri && !hasInlineTranscript;
  const needsDetail = !!postCall.detailGcsUri;
  if (!needsAnalysis && !needsTranscript && !needsDetail) return postCall;

  const downloaded = await downloadCallPayload(postCall, env);
  return {
    ...postCall,
    analysis: needsAnalysis && downloaded.analysis != null ? downloaded.analysis : postCall.analysis,
    transcriptMeta:
      needsTranscript && downloaded.transcriptMeta != null
        ? downloaded.transcriptMeta
        : postCall.transcriptMeta,
    detail: needsDetail && downloaded.detail != null ? downloaded.detail : postCall.detail,
  };
}
