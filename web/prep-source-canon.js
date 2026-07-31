/**
 * Client-side source canonicalisation.
 *
 * MIRROR of worker/src/prep/canonicalize-sources.ts — keep behaviourally identical
 * (shared fixture: worker/testdata/source-canon/cases.json).
 *
 * Running this on the render path repairs briefs that were generated before the server
 * fix and are sitting in localStorage — those still have sparse labels (S15/S23/S28) and
 * orphan labels like R1 that can never resolve. Repair-on-read, no writes, no migration.
 */

import {
  RESERVED_LABELS,
  UNATTRIBUTED_LABEL,
  sourceDisplayName,
  sourceDomainKey,
} from "./prep-source-display.js";

export const MAX_PREP_SOURCES = 12;
const MIN_PREP_SOURCES = 3;

const VIRTUAL_SOURCES = [
  { label: "SE", title: "SE additional context", url: "se-context", confidence: 88, displayName: "From your input" },
  { label: "Kaia", title: "Kaia meeting summary", url: "kaia-meeting", confidence: 75, displayName: "Kaia" },
  { label: "Zoom", title: "Zoom transcript", url: "zoom-transcript", confidence: 75, displayName: "Zoom" },
  { label: "LinkedIn + Kaia", title: "LinkedIn PDF + Kaia meeting", url: "linkedin-kaia", confidence: 80, displayName: "LinkedIn + Kaia" },
  { label: "LinkedIn PDF", title: "LinkedIn PDF export", url: "linkedin-pdf:upload", confidence: 90, displayName: "LinkedIn PDF" },
  { label: "Orchestrator", title: "Web / LinkedIn research", url: "orchestrator", confidence: 60, displayName: "Web research" },
];

const UNATTRIBUTED_SOURCE = {
  label: UNATTRIBUTED_LABEL,
  title: "Unattributed",
  url: "unknown",
  confidence: 0,
  displayName: "Unattributed",
};

const isHttp = (url) => /^https?:\/\//i.test(String(url || ""));

function preferSource(a, b) {
  if (isHttp(a.url) !== isHttp(b.url)) return isHttp(a.url) ? a : b;
  return (Number(b.confidence) || 0) > (Number(a.confidence) || 0) ? b : a;
}

function collectReferencedLabels(prep) {
  const out = [];
  const push = (label) => {
    const s = String(label ?? "").trim();
    if (s) out.push(s);
  };
  for (const f of prep.facts || []) push(f.sourceLabel);
  for (const s of prep.signals || []) push(s.sourceLabel);
  push(prep.supportJD?.sourceLabel);
  for (const p of prep.prospects || []) push(p.sourceLabel);
  return out;
}

/** @returns {{ prep: object, remap: Map<string,string>, unresolved: string[] }} */
export function canonicalizePrepSources(prep, opts = {}) {
  if (!prep) return { prep, remap: new Map(), unresolved: [] };
  const maxSources = opts.maxSources ?? MAX_PREP_SOURCES;

  const pool = new Map();
  const addToPool = (src) => {
    const label = String(src?.label ?? "").trim();
    if (!src || !label) return;
    const existing = pool.get(label);
    pool.set(label, existing ? preferSource(existing, src) : { ...src });
  };
  for (const s of prep.sources || []) addToPool(s);
  for (const s of opts.authoritative || []) addToPool(s);
  for (const s of VIRTUAL_SOURCES) addToPool(s);

  const groupOfLabel = new Map();
  const groupMembers = new Map();
  for (const [label, src] of pool) {
    const key = sourceDomainKey(src.url) || `label:${label}`;
    groupOfLabel.set(label, key);
    const members = groupMembers.get(key);
    if (members) members.push(src);
    else groupMembers.set(key, [src]);
  }

  const referenced = collectReferencedLabels(prep);
  const remap = new Map();
  const canonicalOfGroup = new Map();
  const ordered = [];
  const unresolved = [];
  let n = 0;

  const materialize = (key) => {
    const existing = canonicalOfGroup.get(key);
    if (existing) return existing;
    const members = groupMembers.get(key) || [];
    const best = members.reduce((acc, m) => preferSource(acc, m), members[0]);
    const reserved = members.find((m) => RESERVED_LABELS.includes(m.label));
    const label = reserved ? reserved.label : `S${++n}`;
    const canonical = {
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
      unresolved.push(label);
      remap.set(label, UNATTRIBUTED_LABEL);
      continue;
    }
    materialize(key);
  }

  for (const key of groupMembers.keys()) {
    if (ordered.length >= maxSources) break;
    if (canonicalOfGroup.has(key)) continue;
    const members = groupMembers.get(key) || [];
    if (members.every((m) => VIRTUAL_SOURCES.some((v) => v.label === m.label))) continue;
    materialize(key);
  }

  if (unresolved.length) ordered.push({ ...UNATTRIBUTED_SOURCE });

  const relabel = (label) => {
    const s = String(label ?? "").trim();
    if (!s) return UNATTRIBUTED_LABEL;
    return remap.get(s) ?? s;
  };

  const out = {
    ...prep,
    facts: (prep.facts || []).map((f) => ({ ...f, sourceLabel: relabel(f.sourceLabel) })),
    signals: (prep.signals || []).map((s) => ({ ...s, sourceLabel: relabel(s.sourceLabel) })),
    prospects: (prep.prospects || []).map((p) => ({ ...p, sourceLabel: relabel(p.sourceLabel) })),
    sources: padToMinimum(ordered),
  };
  if (prep.supportJD) {
    out.supportJD = { ...prep.supportJD, sourceLabel: relabel(prep.supportJD.sourceLabel) };
  }

  return { prep: out, remap, unresolved };
}

function padToMinimum(sources) {
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
