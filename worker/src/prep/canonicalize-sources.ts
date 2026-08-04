/**
 * Make a Prep's source citations trustworthy and readable.
 *
 * Establishes one invariant:
 *   every sourceLabel appearing anywhere in the Prep resolves to an entry in
 *   prep.sources[], numbering is contiguous S1..Sn in first-reference order,
 *   reserved non-numeric labels are never renumbered, and no row is ever silently
 *   reattributed to an unrelated source.
 *
 * Deliberately does NOT touch researchBundle.sources — those labels stay sparse and
 * serve as an internal join key, which is what keeps the /api/prep/synthesize
 * post-back contract working (the browser sends confirmedFacts back and the worker
 * resolves them against the bundle).
 *
 * Idempotent: running it on already-canonical output is a no-op.
 *
 * MIRROR: web/prep-source-canon.js must stay behaviourally identical. Shared fixture:
 * worker/testdata/source-canon/cases.json.
 */

import type { Prep, PrepSource } from "../schema";
import {
  RESERVED_LABELS,
  UNATTRIBUTED_LABEL,
  sourceDisplayName,
  sourceDomainKey,
} from "./source-display";

/** Soft cap on the unreferenced tail. Referenced sources are never dropped. */
export const MAX_PREP_SOURCES = 12;
/** PREP_SCHEMA.sources requires at least this many. */
const MIN_PREP_SOURCES = 3;

/**
 * Sources that exist conceptually but were never added to sources[], so their labels
 * could never resolve and always rendered UNVERIFIED.
 *
 * Registering them here — rather than renaming them — is what keeps the label regexes
 * in web/precall-render.js (/kaia/i, /linkedin/i, === "SE") matching. The non-http
 * sentinel URLs pass isUnverifiedSource exactly as SE_SOURCE's "se-context" does.
 */
const VIRTUAL_SOURCES: PrepSource[] = [
  { label: "SE", title: "SE additional context", url: "se-context", confidence: 90, displayName: "From your input" },
  { label: "Kaia", title: "Kaia meeting summary", url: "kaia-meeting", confidence: 75, displayName: "Kaia" },
  { label: "Zoom", title: "Zoom transcript", url: "zoom-transcript", confidence: 75, displayName: "Zoom" },
  {
    label: "LinkedIn + Kaia",
    title: "LinkedIn PDF + Kaia meeting",
    url: "linkedin-kaia",
    confidence: 80,
    displayName: "LinkedIn + Kaia",
  },
  { label: "LinkedIn PDF", title: "LinkedIn PDF export", url: "linkedin-pdf:upload", confidence: 90, displayName: "LinkedIn PDF" },
  { label: "Orchestrator", title: "Web / LinkedIn research", url: "orchestrator", confidence: 60, displayName: "Web research" },
];

const UNATTRIBUTED_SOURCE: PrepSource = {
  label: UNATTRIBUTED_LABEL,
  title: "Unattributed",
  url: "unknown",
  confidence: 0,
  displayName: "Unattributed",
};

export interface CanonicalizeOptions {
  /** The authoritative research table. Union'd into the pool and preferred on conflict. */
  authoritative?: PrepSource[];
  maxSources?: number;
}

export interface CanonicalizeResult {
  prep: Prep;
  /** old label -> new label. Diagnostics only. */
  remap: Map<string, string>;
  /** Labels a row referenced that matched no pool entry. */
  unresolved: string[];
}

/** Every place a Prep stores a sourceLabel, in the order they should be numbered. */
function collectReferencedLabels(prep: Prep): string[] {
  const out: string[] = [];
  const push = (label: unknown) => {
    const s = String(label ?? "").trim();
    if (s) out.push(s);
  };
  for (const f of prep.facts || []) push(f.sourceLabel);
  for (const s of prep.signals || []) push(s.sourceLabel);
  push(prep.supportJD?.sourceLabel);
  for (const p of prep.prospects || []) push(p.sourceLabel);
  for (const n of prep.recentNews || []) push(n.sourceLabel);
  return out;
}

function isHttp(url: unknown): boolean {
  return /^https?:\/\//i.test(String(url || ""));
}

/** Pick the better of two entries describing the same source. */
function preferSource(a: PrepSource, b: PrepSource): PrepSource {
  if (isHttp(a.url) !== isHttp(b.url)) return isHttp(a.url) ? a : b;
  return (Number(b.confidence) || 0) > (Number(a.confidence) || 0) ? b : a;
}

export function canonicalizePrepSources(
  prep: Prep,
  opts: CanonicalizeOptions = {},
): CanonicalizeResult {
  const maxSources = opts.maxSources ?? MAX_PREP_SOURCES;

  // 1. Pool every source we know about, keyed by label.
  const pool = new Map<string, PrepSource>();
  const addToPool = (src: PrepSource | undefined) => {
    const label = String(src?.label ?? "").trim();
    if (!src || !label) return;
    const existing = pool.get(label);
    pool.set(label, existing ? preferSource(existing, src) : { ...src });
  };
  for (const s of prep.sources || []) addToPool(s);
  for (const s of opts.authoritative || []) addToPool(s);
  for (const s of VIRTUAL_SOURCES) addToPool(s);

  // 2. Group by domain so many URLs on one host become one chip. Safe because the UI
  //    now shows the domain — two URLs on one host would render identically anyway.
  const groupOfLabel = new Map<string, string>();
  const groupMembers = new Map<string, PrepSource[]>();
  for (const [label, src] of pool) {
    const key = sourceDomainKey(src.url) || `label:${label}`;
    groupOfLabel.set(label, key);
    const members = groupMembers.get(key);
    if (members) members.push(src);
    else groupMembers.set(key, [src]);
  }

  // 3. Number groups in the order rows first reference them.
  const referenced = collectReferencedLabels(prep);
  const remap = new Map<string, string>();
  const canonicalOfGroup = new Map<string, PrepSource>();
  const ordered: PrepSource[] = [];
  const unresolved: string[] = [];
  let n = 0;

  const materialize = (key: string): PrepSource => {
    const existing = canonicalOfGroup.get(key);
    if (existing) return existing;

    const members = groupMembers.get(key) || [];
    const best = members.reduce((acc, m) => preferSource(acc, m), members[0]);
    // A reserved label keeps its literal text and consumes no number.
    const reserved = members.find((m) => RESERVED_LABELS.includes(m.label));
    const label = reserved ? reserved.label : `S${++n}`;

    const canonical: PrepSource = {
      label,
      title: (reserved || best).title,
      url: best.url,
      confidence: members.reduce((max, m) => Math.max(max, Number(m.confidence) || 0), 0),
    };
    canonical.displayName = (reserved || best).displayName || sourceDisplayName(canonical);

    canonicalOfGroup.set(key, canonical);
    ordered.push(canonical);
    for (const m of members) remap.set(m.label, label);
    return canonical;
  };

  for (const label of referenced) {
    if (remap.has(label)) continue;
    const key = groupOfLabel.get(label);
    if (!key) {
      // Never guess positionally — that is what made chips name the wrong publisher.
      unresolved.push(label);
      remap.set(label, UNATTRIBUTED_LABEL);
      continue;
    }
    materialize(key);
  }

  // 4. Keep unreferenced sources for the detail list, up to the cap. Referenced ones
  //    are already in `ordered` and are never dropped, even past the cap.
  for (const key of groupMembers.keys()) {
    if (ordered.length >= maxSources) break;
    if (canonicalOfGroup.has(key)) continue;
    // Virtual entries nobody cited would be noise in the sources list.
    const members = groupMembers.get(key) || [];
    if (members.every((m) => VIRTUAL_SOURCES.some((v) => v.label === m.label))) continue;
    materialize(key);
  }

  if (unresolved.length) {
    ordered.push({ ...UNATTRIBUTED_SOURCE });
    console.warn(
      `[prep/canonicalize] ${unresolved.length} unresolvable source label(s): ${[...new Set(unresolved)].join(", ")}`,
    );
  }

  // 5. Rewrite every reference.
  const relabel = (label: unknown): string => {
    const s = String(label ?? "").trim();
    if (!s) return UNATTRIBUTED_LABEL;
    return remap.get(s) ?? s;
  };

  const out: Prep = {
    ...prep,
    facts: (prep.facts || []).map((f) => ({ ...f, sourceLabel: relabel(f.sourceLabel) })),
    signals: (prep.signals || []).map((s) => ({ ...s, sourceLabel: relabel(s.sourceLabel) })),
    prospects: (prep.prospects || []).map((p) => ({ ...p, sourceLabel: relabel(p.sourceLabel) })),
    sources: padToMinimum(ordered),
  };
  if (prep.supportJD) {
    out.supportJD = { ...prep.supportJD, sourceLabel: relabel(prep.supportJD.sourceLabel) };
  }
  if (prep.recentNews?.length) {
    out.recentNews = prep.recentNews.map((n) => ({ ...n, sourceLabel: relabel(n.sourceLabel) }));
  }

  return { prep: out, remap, unresolved };
}

/**
 * Domain merging can push below PREP_SCHEMA's minItems, so top up afterwards.
 * A one-row "Sources & confidence" table reads as broken.
 */
function padToMinimum(sources: PrepSource[]): PrepSource[] {
  if (sources.length >= MIN_PREP_SOURCES) return sources;
  const out = [...sources];
  let n = out.reduce((max, s) => {
    const m = /^S(\d+)$/.exec(s.label);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  while (out.length < MIN_PREP_SOURCES) {
    out.push({
      label: `S${++n}`,
      title: "unknown",
      url: "unknown",
      confidence: 50,
      displayName: "Unattributed",
    });
  }
  return out;
}
