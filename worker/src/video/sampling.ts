/**
 * Strategic Pass 2 sampling windows — fast targeted clips instead of full-call scan.
 */

export interface SampleWindow {
  startS: number;
  endS: number;
  label: string;
}

/** Seconds between frames inside each strategic window (~5 frames per 15s window). */
export const STRATEGIC_WINDOW_SAMPLE_INTERVAL_S = 3;

/**
 * Sampling plan:
 * - 15s in the first 10% of the call
 * - 15s at 30%, 60%, 90%
 * - last 60s towards the end
 */
export function computeStrategicSampleWindows(durationSec: number): SampleWindow[] {
  const dur = Math.max(60, Math.round(durationSec));
  const firstEnd = Math.min(15, Math.max(1, Math.round(dur * 0.1)));
  const windows: SampleWindow[] = [{ startS: 0, endS: firstEnd, label: "opening_10pct" }];

  for (const pct of [0.3, 0.6, 0.9]) {
    const center = dur * pct;
    let start = Math.max(0, Math.round(center - 7.5));
    let end = Math.min(dur, start + 15);
    if (end - start < 5) start = Math.max(0, end - 15);
    windows.push({
      startS: start,
      endS: end,
      label: `pct_${Math.round(pct * 100)}`,
    });
  }

  windows.push({
    startS: Math.max(0, dur - 60),
    endS: dur,
    label: "closing_1min",
  });

  return windows;
}

export interface ParticipantCameraAggregate {
  name: string;
  role?: string | null;
  secondsOn: number;
  secondsOff: number;
  cameraOn: boolean;
}

/** Majority of sampled on-time vs off-time — tie goes to on. */
export function aggregateParticipantCamera(
  rows: Array<{ name: string; role?: string | null; secondsOn: number; secondsOff: number }>,
): ParticipantCameraAggregate[] {
  const byKey = new Map<
    string,
    { name: string; role?: string | null; secondsOn: number; secondsOff: number }
  >();

  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      prev.secondsOn += row.secondsOn;
      prev.secondsOff += row.secondsOff;
      if (!prev.role && row.role) prev.role = row.role;
    } else {
      byKey.set(key, {
        name,
        role: row.role ?? null,
        secondsOn: row.secondsOn,
        secondsOff: row.secondsOff,
      });
    }
  }

  return [...byKey.values()].map((r) => ({
    ...r,
    cameraOn: r.secondsOn >= r.secondsOff,
  }));
}

/** Total sampled seconds across strategic windows (4×15s + 60s closing). */
export const STRATEGIC_SAMPLE_DURATION_S = 4 * 15 + 60;

export interface VisionIdentities {
  seIdentity?: string | null;
  aeIdentity?: string | null;
  customerIdentities?: string[] | null;
}

export interface AttendeeCameraRow {
  name: string;
  role?: string | null;
  talkPct?: number | null;
  cameraOn?: boolean | null;
  cameraOnPct?: number | null;
}

/** Normalize participant labels for fuzzy identity matching (mirrors call-view.js). */
export function normalizePersonKey(label: string): string {
  let key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\|.*$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = key.indexOf("@");
  if (at >= 0) {
    key = key
      .slice(0, at)
      .replace(/[._-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return key;
}

export function identityMatchesName(identity: string, geminiName: string): boolean {
  const idKey = normalizePersonKey(identity);
  const nameKey = normalizePersonKey(geminiName);
  if (!idKey || !nameKey) return false;
  if (idKey === nameKey) return true;
  if (nameKey.includes(idKey) || idKey.includes(nameKey)) return true;
  const idFirst = idKey.split(/\s+/)[0] || "";
  const nameFirst = nameKey.split(/\s+/)[0] || "";
  if (idFirst.length >= 3 && idFirst === nameFirst) return true;
  return false;
}

export function participantCameraOnPct(p: ParticipantCameraAggregate): number {
  const total = p.secondsOn + p.secondsOff;
  if (total <= 0) return p.cameraOn ? 100 : 0;
  return Math.round((p.secondsOn / total) * 100);
}

function inferRoleFromName(name: string, identities: VisionIdentities): string | null {
  const n = name.trim().toLowerCase();
  if (/^(se|solution engineer|sales engineer)$/i.test(n)) return "se";
  if (/^(ae|account executive)$/i.test(n)) return "ae";
  if (/^customer(\s|\d|$)/i.test(n)) return "customer";
  if (identities.seIdentity && identityMatchesName(identities.seIdentity, name)) return "se";
  if (identities.aeIdentity && identityMatchesName(identities.aeIdentity, name)) return "ae";
  if ((identities.customerIdentities || []).some((c) => identityMatchesName(c, name))) {
    return "customer";
  }
  return null;
}

function parseParticipantState(
  rawState: unknown,
  windowDur: number,
): { secondsOn: number; secondsOff: number } {
  let secondsOn = 0;
  let secondsOff = 0;
  if (typeof rawState === "boolean") {
    secondsOn = rawState ? windowDur : 0;
    secondsOff = rawState ? 0 : windowDur;
  } else if (typeof rawState === "string") {
    const s = rawState.trim().toLowerCase();
    if (s === "on" || s === "true") secondsOn = windowDur;
    else if (s === "off" || s === "false") secondsOff = windowDur;
  } else if (rawState && typeof rawState === "object") {
    const st = rawState as Record<string, unknown>;
    if (typeof st.secondsOn === "number" && Number.isFinite(st.secondsOn)) {
      secondsOn = Math.max(0, st.secondsOn);
    }
    if (typeof st.secondsOff === "number" && Number.isFinite(st.secondsOff)) {
      secondsOff = Math.max(0, st.secondsOff);
    }
    if (!secondsOn && !secondsOff) {
      const cam = st.cameraOn ?? st.camOn ?? st.camera;
      if (typeof cam === "boolean") {
        secondsOn = cam ? windowDur : 0;
        secondsOff = cam ? 0 : windowDur;
      } else if (typeof cam === "string") {
        const on = cam.trim().toLowerCase() === "on";
        secondsOn = on ? windowDur : 0;
        secondsOff = on ? 0 : windowDur;
      }
    }
    if (!secondsOn && !secondsOff && typeof st.cameraOnPct === "number") {
      const pct = Math.max(0, Math.min(100, st.cameraOnPct));
      secondsOn = Math.round((pct / 100) * windowDur);
      secondsOff = Math.max(0, windowDur - secondsOn);
    }
  }
  return { secondsOn, secondsOff };
}

/**
 * Parse Gemini vision JSON into per-participant camera aggregates.
 * Accepts `windows[]` (preferred) or flat `participants[]` fallback shapes.
 */
export function parseVisionCameraResponse(
  parsed: Record<string, unknown>,
  identities: VisionIdentities = {},
): ParticipantCameraAggregate[] {
  const rows: Array<{ name: string; role?: string | null; secondsOn: number; secondsOff: number }> =
    [];

  const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
  for (const win of windows) {
    if (!win || typeof win !== "object") continue;
    const w = win as Record<string, unknown>;
    const windowDur =
      typeof w.windowSeconds === "number" && Number.isFinite(w.windowSeconds)
        ? Math.max(1, Math.round(w.windowSeconds))
        : 15;
    const participants = w.participants;
    if (!participants || typeof participants !== "object") continue;

    for (const [rawName, rawState] of Object.entries(participants as Record<string, unknown>)) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      const { secondsOn, secondsOff } = parseParticipantState(rawState, windowDur);
      rows.push({
        name,
        role: inferRoleFromName(name, identities),
        secondsOn,
        secondsOff,
      });
    }
  }

  const flat = Array.isArray(parsed.participants) ? parsed.participants : [];
  for (const row of flat) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    let secondsOn =
      typeof r.secondsOn === "number" && Number.isFinite(r.secondsOn) ? Math.max(0, r.secondsOn) : 0;
    let secondsOff =
      typeof r.secondsOff === "number" && Number.isFinite(r.secondsOff)
        ? Math.max(0, r.secondsOff)
        : 0;
    if (!secondsOn && !secondsOff) {
      const fallbackDur = STRATEGIC_SAMPLE_DURATION_S;
      const cam = r.cameraOn ?? r.camOn ?? r.camera;
      if (typeof cam === "boolean") {
        secondsOn = cam ? fallbackDur : 0;
        secondsOff = cam ? 0 : fallbackDur;
      } else if (typeof cam === "string") {
        const on = cam.trim().toLowerCase() === "on";
        secondsOn = on ? fallbackDur : 0;
        secondsOff = on ? 0 : fallbackDur;
      } else if (typeof r.cameraOnPct === "number" && Number.isFinite(r.cameraOnPct)) {
        const pct = Math.max(0, Math.min(100, r.cameraOnPct));
        secondsOn = Math.round((pct / 100) * fallbackDur);
        secondsOff = Math.max(0, fallbackDur - secondsOn);
      }
    }
    rows.push({
      name,
      role:
        (typeof r.role === "string" ? r.role.trim().slice(0, 40) : null) ||
        inferRoleFromName(name, identities),
      secondsOn,
      secondsOff,
    });
  }

  return aggregateParticipantCamera(rows);
}

/** Map Gemini aggregates onto confirmed intake identities for UI lookup. */
export function buildAttendeeCurveFromAggregated(
  aggregated: ParticipantCameraAggregate[],
  identities: VisionIdentities,
): AttendeeCameraRow[] {
  const used = new Set<string>();
  const rows: AttendeeCameraRow[] = [];

  const claim = (
    agg: ParticipantCameraAggregate | undefined,
    canonicalName: string,
    role: string,
  ) => {
    const pct = agg ? participantCameraOnPct(agg) : null;
    rows.push({
      name: canonicalName,
      role,
      talkPct: null,
      cameraOn: agg?.cameraOn ?? (pct != null ? pct >= 50 : null),
      cameraOnPct: pct,
    });
    if (agg) used.add(agg.name.toLowerCase());
  };

  const findMatch = (identity: string, role: string) =>
    aggregated.find(
      (p) =>
        !used.has(p.name.toLowerCase()) &&
        (identityMatchesName(identity, p.name) || p.role === role),
    ) ||
    aggregated.find((p) => !used.has(p.name.toLowerCase()) && p.role === role);

  if (identities.seIdentity?.trim()) {
    claim(findMatch(identities.seIdentity, "se"), identities.seIdentity.trim(), "se");
  }
  if (identities.aeIdentity?.trim()) {
    claim(findMatch(identities.aeIdentity, "ae"), identities.aeIdentity.trim(), "ae");
  }
  for (const customer of (identities.customerIdentities || []).filter(Boolean)) {
    claim(findMatch(customer, "customer"), customer.trim(), "customer");
  }

  for (const p of aggregated) {
    if (used.has(p.name.toLowerCase())) continue;
    rows.push({
      name: p.name,
      role: p.role,
      talkPct: null,
      cameraOn: p.cameraOn,
      cameraOnPct: participantCameraOnPct(p),
    });
  }

  return rows;
}

/** Merge talk-share from transcript inference into vision camera rows (by identity). */
export function mergeAttendeeCurveTalk(
  cameraRows: AttendeeCameraRow[] | null | undefined,
  talkRows: AttendeeCameraRow[] | null | undefined,
  identities: VisionIdentities = {},
): AttendeeCameraRow[] | null {
  if (!cameraRows?.length && !talkRows?.length) return null;
  if (!talkRows?.length) return cameraRows?.length ? cameraRows : null;
  if (!cameraRows?.length) return talkRows;

  const talkByKey = new Map<string, AttendeeCameraRow>();
  for (const row of talkRows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    talkByKey.set(normalizePersonKey(name), row);
  }

  const findTalk = (canonicalName: string, role: string) => {
    const key = normalizePersonKey(canonicalName);
    const direct = talkByKey.get(key);
    if (direct?.talkPct != null) return direct.talkPct;
    for (const row of talkRows) {
      if (row.talkPct == null) continue;
      if (identityMatchesName(canonicalName, row.name)) return row.talkPct;
    }
    if (identities.seIdentity && /^(se|solution engineer)$/i.test(role)) {
      const se = talkRows.find(
        (r) =>
          r.talkPct != null &&
          (identityMatchesName(identities.seIdentity!, r.name) || /^se$/i.test(String(r.role || ""))),
      );
      if (se) return se.talkPct;
    }
    return null;
  };

  return cameraRows.map((row) => {
    const role = String(row.role || "").trim();
    const talkPct = row.talkPct ?? findTalk(row.name, role);
    return talkPct == null ? row : { ...row, talkPct };
  });
}

export function seCameraOnPctFromParticipants(
  participants: ParticipantCameraAggregate[],
  seIdentity?: string | null,
): number | null {
  const seRow =
    (seIdentity?.trim() &&
      participants.find((p) => identityMatchesName(seIdentity, p.name))) ||
    participants.find((p) => p.role === "se") ||
    participants.find((p) => /^(se|solution engineer)/i.test(String(p.role || ""))) ||
    participants.find((p) => /engineer/i.test(String(p.role || "")));
  if (!seRow) return null;
  return participantCameraOnPct(seRow);
}
