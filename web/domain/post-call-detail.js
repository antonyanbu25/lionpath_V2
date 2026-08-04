/**
 * Embedded postCalls.detail — per-call satellite rows read together on the detail view.
 * Spills to GCS when the detail map exceeds ~700KB (same bucket as analysis payloads).
 */

/** @typedef {import("./types.js").PostCallDetailMap} PostCallDetailMap */

/** Max items per embedded array (Firestore doc size guard). */
export const DETAIL_ARRAY_CAPS = {
  videoFacts: 5,
  timelineSegments: 200,
  timelineMarkers: 200,
  tcDeltas: 50,
  meddpiccDeltas: 50,
  objections: 100,
  followUps: 100,
  momDrafts: 5,
  dealSignals: 5,
  productGaps: 100,
  whatWorks: 100,
};

/** Spill embedded detail to GCS when JSON exceeds this size. */
export const DETAIL_SPILL_THRESHOLD_BYTES = 700 * 1024;

/** @returns {PostCallDetailMap} */
export function emptyPostCallDetail() {
  return {
    videoFacts: [],
    timelineSegments: [],
    timelineMarkers: [],
    tcDeltas: [],
    meddpiccDeltas: [],
    objections: [],
    followUps: [],
    momDrafts: [],
    dealSignals: [],
    productGaps: [],
    whatWorks: [],
  };
}

/**
 * @param {Partial<PostCallDetailMap>|null|undefined} partial
 * @returns {PostCallDetailMap}
 */
export function mergePostCallDetail(partial) {
  const base = emptyPostCallDetail();
  if (!partial) return base;
  for (const key of Object.keys(base)) {
    if (Array.isArray(partial[key])) base[key] = partial[key];
  }
  return capPostCallDetail(base);
}

/**
 * @param {PostCallDetailMap} detail
 * @returns {PostCallDetailMap}
 */
export function capPostCallDetail(detail) {
  /** @type {PostCallDetailMap} */
  const out = emptyPostCallDetail();
  for (const [key, cap] of Object.entries(DETAIL_ARRAY_CAPS)) {
    const rows = detail[key];
    out[key] = Array.isArray(rows) ? rows.slice(0, cap) : [];
  }
  return out;
}

/**
 * Read embedded detail from a postCall doc (inline or after GCS hydrate).
 * @param {object|null|undefined} postCall
 * @returns {PostCallDetailMap}
 */
export function detailFromPostCall(postCall) {
  if (!postCall) return emptyPostCallDetail();
  if (postCall.detail && typeof postCall.detail === "object") {
    return mergePostCallDetail(postCall.detail);
  }
  return emptyPostCallDetail();
}

/**
 * @param {PostCallDetailMap} detail
 * @param {string} key
 * @param {object[]} rows
 */
export function setDetailArray(detail, key, rows) {
  if (!detail || !key) return;
  const cap = DETAIL_ARRAY_CAPS[key] ?? 200;
  detail[key] = Array.isArray(rows) ? rows.slice(0, cap) : [];
}

/**
 * @param {object|null|undefined} postCall
 * @param {keyof PostCallDetailMap} key
 * @returns {object[]}
 */
export function detailArray(postCall, key) {
  return detailFromPostCall(postCall)[key] || [];
}

/**
 * Flatten dealSignals from postCalls for a deal (new read path).
 * @param {object[]} postCalls
 * @param {number} [limitCount]
 */
export function dealSignalsFromPostCalls(postCalls, limitCount = 50) {
  const rows = [];
  for (const pc of postCalls || []) {
    for (const sig of detailArray(pc, "dealSignals")) {
      rows.push(sig);
    }
  }
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limitCount);
}

/**
 * Flatten tcDeltas from postCalls for a deal.
 * @param {object[]} postCalls
 * @param {number} [limitCount]
 */
export function tcDeltasFromPostCalls(postCalls, limitCount = 200) {
  const rows = [];
  for (const pc of postCalls || []) {
    for (const row of detailArray(pc, "tcDeltas")) {
      rows.push(row);
    }
  }
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limitCount);
}
