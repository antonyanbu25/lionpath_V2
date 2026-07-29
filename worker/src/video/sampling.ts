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

export function seCameraOnPctFromParticipants(
  participants: ParticipantCameraAggregate[],
  seIdentity?: string | null,
): number | null {
  const seKey = String(seIdentity || "")
    .trim()
    .toLowerCase();
  const seRow =
    (seKey && participants.find((p) => p.name.toLowerCase() === seKey)) ||
    participants.find((p) => /^(se|solution engineer)/i.test(String(p.role || ""))) ||
    participants.find((p) => /engineer/i.test(String(p.role || "")));
  if (!seRow) return null;
  const total = seRow.secondsOn + seRow.secondsOff;
  if (total <= 0) return seRow.cameraOn ? 100 : 0;
  return Math.round((seRow.secondsOn / total) * 100);
}
