/**
 * Three-bucket placement for "How big is this fish?" INPUT rows (SE context sizing).
 * Mirrors parseMagnitude from worker/src/prep/rivals.ts for comparable ordering.
 */

export const FISH_SIZE_BUCKETS = {
  employees: {
    labels: ["0–50", "50–250", ">250"],
    /** [0,50], (50,250], (250,∞) */
    thresholds: [50, 250],
  },
  funding: {
    labels: ["0–1", "1–10", ">10"],
    /** Values compared in millions USD */
    thresholds: [1, 10],
    unitNote: "millions USD",
  },
  supportAgents: {
    labels: ["1–25", "25–100", ">100"],
    /** [1,25], (25,100], (100,∞) */
    thresholds: [25, 100],
    min: 1,
  },
};

const MAGNITUDE_SUFFIXES = [
  [/^(?:t|tn|trillion)$/i, 1e12],
  [/^(?:b|bn|billion)$/i, 1e9],
  [/^(?:m|mm|mn|million)$/i, 1e6],
  [/^(?:k|thousand)$/i, 1e3],
];

const NON_VALUES = /^(?:|-|–|—|n\/?a|unknown|none|tbd|undisclosed|not disclosed|\?)$/i;

/** Map metric label to bucket type, or null if unrecognized. */
export function resolveFishBucketType(label) {
  const l = String(label || "").toLowerCase().trim();
  if (!l) return null;
  if (/\b(employees?|headcount|staff)\b/.test(l) && !/\bsupport\b/.test(l)) return "employees";
  if (/\bfunding\b/.test(l)) return "funding";
  if (/\b(support agents?|support team|support users?)\b/.test(l)) return "supportAgents";
  if (/^agents?$/.test(l)) return "supportAgents";
  return null;
}

/** Parse a reported figure into a comparable number (ordering-only). */
export function parseFishMetricValue(raw) {
  const text = String(raw ?? "").trim();
  if (NON_VALUES.test(text)) return null;

  const match = text.match(
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(t|tn|trillion|b|bn|billion|m|mm|mn|million|k|thousand)?/i,
  );
  if (!match) return null;

  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const suffix = (match[2] || "").trim();
  if (!suffix) return n;
  for (const [pattern, multiplier] of MAGNITUDE_SUFFIXES) {
    if (pattern.test(suffix)) return n * multiplier;
  }
  return n;
}

/** Normalize funding to millions USD for bucket comparison. */
export function fundingValueInMillions(numeric) {
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 1e6) return numeric / 1e6;
  return numeric;
}

/**
 * Which bucket (0|1|2) and dot position (centre of bucket as %).
 * @returns {{ bucketIndex: number, dotPercent: number, labels: string[], unitNote?: string } | null}
 */
export function fishBucketPlacement(type, numeric) {
  const config = FISH_SIZE_BUCKETS[type];
  if (!config || !Number.isFinite(numeric)) return null;

  let compare = numeric;
  if (type === "funding") {
    compare = fundingValueInMillions(numeric);
    if (!Number.isFinite(compare)) return null;
  }

  const [t0, t1] = config.thresholds;
  let bucketIndex = 0;
  if (type === "supportAgents") {
    const min = config.min ?? 1;
    if (compare <= min || compare <= t0) bucketIndex = 0;
    else if (compare <= t1) bucketIndex = 1;
    else bucketIndex = 2;
  } else if (type === "employees") {
    if (compare <= t0) bucketIndex = 0;
    else if (compare <= t1) bucketIndex = 1;
    else bucketIndex = 2;
  } else if (type === "funding") {
    if (compare <= t0) bucketIndex = 0;
    else if (compare <= t1) bucketIndex = 1;
    else bucketIndex = 2;
  }

  const dotPercent = ((bucketIndex + 0.5) / 3) * 100;
  return {
    bucketIndex,
    dotPercent,
    labels: config.labels,
    unitNote: config.unitNote,
  };
}

/** Resolve label + value string into bucket placement, or null. */
export function fishBucketFromMetric(label, value) {
  const type = resolveFishBucketType(label);
  if (!type) return null;
  const numeric = parseFishMetricValue(value);
  if (numeric == null) return null;
  const placement = fishBucketPlacement(type, numeric);
  if (!placement) return null;
  return { type, numeric, ...placement };
}
