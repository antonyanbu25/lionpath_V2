/**
 * Recent news builder — company events from Gemini research, not tech signals.
 * MIRROR: worker/src/prep/recent-news.ts must stay behaviourally identical.
 */

const UNKNOWN = "unknown";

const SIGNAL_LIKE_KEY =
  /incumbent|integration|widget|help\s*center|support\s*portal|chat|zendesk|intercom|freshdesk|hiring\s*support|crm|tech\s*stack|ai\s*in/i;

function isUnknown(v) {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === UNKNOWN || s === "-";
}

/**
 * The SE's own notes are not news. MIRROR of isSeSourced in worker/src/prep/recent-news.ts.
 *
 * The confidence gate below rejects *unsourced* claims; SE_SOURCE carries confidence 88 and a
 * non-empty url ("se-context"), so it passed and the SE's typed context came back as news.
 */
function isSeSourced(fact, src) {
  if (String(fact.sourceLabel || "").trim().toUpperCase() === "SE") return true;
  if (String(fact.sourceUrl || "").trim().toLowerCase() === "se-context") return true;
  return String(src?.url || "").trim().toLowerCase() === "se-context";
}

function isLowConfidenceSource(src) {
  if (!src) return true;
  const url = String(src.url || "").trim().toLowerCase();
  if (!url || url === UNKNOWN) return true;
  return (Number(src.confidence) || 0) < 55;
}

function trimWords(s, max) {
  const parts = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= max) return parts.join(" ");
  return `${parts.slice(0, max).join(" ")}…`;
}

/** @param {Array<{key?:string,value?:string,sourceLabel?:string,category?:string}>} facts */
/** @param {Array<{label:string,url?:string,confidence?:number}>} sources */
export function buildRecentNews(facts, sources, maxItems = 4) {
  const srcByLabel = new Map((sources || []).map((s) => [s.label, s]));
  const seen = new Set();
  const out = [];

  for (const f of facts || []) {
    if (f.category !== "news") continue;
    if (isUnknown(f.value)) continue;
    if (SIGNAL_LIKE_KEY.test(String(f.key || ""))) continue;

    const src = srcByLabel.get(f.sourceLabel);
    if (isSeSourced(f, src)) continue;
    if (isLowConfidenceSource(src)) continue;

    const headline = trimWords(String(f.key || "News"), 8);
    const detail = trimWords(String(f.value || ""), 18);
    const dedupeKey = `${headline.toLowerCase()}|${detail.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      headline,
      detail,
      sourceLabel: f.sourceLabel,
    });
    if (out.length >= maxItems) break;
  }

  return out;
}

/** Fill recentNews on older briefs — server is authoritative; do not backfill from bundle. */
export function hydrateRecentNews(prep, meta = {}) {
  return prep;
}
