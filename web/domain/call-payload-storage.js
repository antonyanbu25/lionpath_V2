/**
 * Offload large postCall analysis/transcript/detail payloads to GCS (via worker API).
 * Firestore keeps only gs:// URI + byte size when a blob exceeds threshold.
 */
import { WORKER_BASE_URL } from "../firebase-config.js";
import { DETAIL_SPILL_THRESHOLD_BYTES, emptyPostCallDetail } from "./post-call-detail.js";

export const PAYLOAD_OFFLOAD_THRESHOLD_BYTES = 200 * 1024;
export { DETAIL_SPILL_THRESHOLD_BYTES };

/** @type {(() => Promise<string|null>)|null} */
let getAuthToken = null;

/** @param {() => Promise<string|null>} fn */
export function setCallPayloadAuthGetter(fn) {
  getAuthToken = fn || null;
}

export function clearCallPayloadAuthGetter() {
  getAuthToken = null;
}

async function authHeaders() {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* dummy mode */
    }
  }
  return headers;
}

/** @param {unknown} value */
export function jsonByteSize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

/**
 * Strip or offload large blobs before Firestore write.
 * @param {string} callId
 * @param {{ analysis?: object, transcriptMeta?: unknown }} payload
 */
export async function preparePostCallPayloadForFirestore(callId, payload) {
  const analysis = payload?.analysis;
  const transcriptMeta = payload?.transcriptMeta;
  const analysisBytes = jsonByteSize(analysis);
  const transcriptBytes = jsonByteSize(transcriptMeta);

  const needsOffload =
    analysisBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES ||
    transcriptBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES;

  if (!needsOffload) {
    return {
      analysis: analysis ?? {},
      transcriptMeta: transcriptMeta ?? null,
      analysisGcsUri: null,
      analysisByteSize: analysisBytes || null,
      transcriptMetaGcsUri: null,
      transcriptMetaByteSize: transcriptBytes || null,
    };
  }

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/calls/${encodeURIComponent(callId)}/offload-payload`, {
      method: "POST",
      headers: await authHeaders(),
      credentials: "include",
      body: JSON.stringify({ analysis, transcriptMeta }),
    });
    if (!res.ok) {
      console.warn("[call-payload] offload failed, keeping inline payload:", res.status);
      return {
        analysis: analysis ?? {},
        transcriptMeta: transcriptMeta ?? null,
        analysisGcsUri: null,
        analysisByteSize: analysisBytes || null,
        transcriptMetaGcsUri: null,
        transcriptMetaByteSize: transcriptBytes || null,
      };
    }
    const data = await res.json();
    return {
      analysis: analysisBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES ? {} : analysis ?? {},
      transcriptMeta: transcriptBytes > PAYLOAD_OFFLOAD_THRESHOLD_BYTES ? null : transcriptMeta ?? null,
      analysisGcsUri: data.analysisGcsUri ?? null,
      analysisByteSize: data.analysisByteSize ?? analysisBytes ?? null,
      transcriptMetaGcsUri: data.transcriptMetaGcsUri ?? null,
      transcriptMetaByteSize: data.transcriptMetaByteSize ?? transcriptBytes ?? null,
    };
  } catch (err) {
    console.warn("[call-payload] offload error, keeping inline payload:", err?.message || err);
    return {
      analysis: analysis ?? {},
      transcriptMeta: transcriptMeta ?? null,
      analysisGcsUri: null,
      analysisByteSize: analysisBytes || null,
      transcriptMetaGcsUri: null,
      transcriptMetaByteSize: transcriptBytes || null,
    };
  }
}

/**
 * Hydrate inline analysis/transcript from GCS when loading a detail doc.
 * @param {object|null} postCall
 */
function detailNeedsHydrate(postCall) {
  return !!postCall?.detailGcsUri;
}

export async function hydratePostCallPayloadFromGcs(postCall) {
  if (!postCall) return postCall;
  const needsAnalysis = postCall.analysisGcsUri && !Object.keys(postCall.analysis || {}).length;
  const needsTranscript = postCall.transcriptMetaGcsUri && !postCall.transcriptMeta;
  const needsDetail = detailNeedsHydrate(postCall);
  if (!needsAnalysis && !needsTranscript && !needsDetail) return postCall;

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/calls/${encodeURIComponent(postCall.id)}/payload`, {
      headers: await authHeaders(),
      credentials: "include",
    });
    if (!res.ok) return postCall;
    const data = await res.json();
    return {
      ...postCall,
      analysis: needsAnalysis && data.analysis ? data.analysis : postCall.analysis,
      transcriptMeta: needsTranscript && data.transcriptMeta ? data.transcriptMeta : postCall.transcriptMeta,
      detail: needsDetail && data.detail ? data.detail : postCall.detail,
    };
  } catch (err) {
    console.warn("[call-payload] hydrate failed:", err?.message || err);
    return postCall;
  }
}

/**
 * Strip or offload embedded detail before Firestore write.
 * @param {string} callId
 * @param {import("./types.js").PostCallDetailMap} detail
 */
export async function preparePostCallDetailForFirestore(callId, detail) {
  const capped = detail || emptyPostCallDetail();
  const detailBytes = jsonByteSize(capped);

  if (detailBytes <= DETAIL_SPILL_THRESHOLD_BYTES) {
    return {
      detail: capped,
      detailGcsUri: null,
      detailByteSize: detailBytes || null,
    };
  }

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/calls/${encodeURIComponent(callId)}/offload-payload`, {
      method: "POST",
      headers: await authHeaders(),
      credentials: "include",
      body: JSON.stringify({ detail: capped }),
    });
    if (!res.ok) {
      console.warn("[call-payload] detail offload failed, keeping inline:", res.status);
      return {
        detail: capped,
        detailGcsUri: null,
        detailByteSize: detailBytes || null,
      };
    }
    const data = await res.json();
    return {
      detail: {
        ...emptyPostCallDetail(),
        // Pin small arrays used for deal-level scans when the rest is in GCS.
        dealSignals: capped.dealSignals || [],
      },
      detailGcsUri: data.detailGcsUri ?? null,
      detailByteSize: data.detailByteSize ?? detailBytes ?? null,
    };
  } catch (err) {
    console.warn("[call-payload] detail offload error, keeping inline:", err?.message || err);
    return {
      detail: capped,
      detailGcsUri: null,
      detailByteSize: detailBytes || null,
    };
  }
}
