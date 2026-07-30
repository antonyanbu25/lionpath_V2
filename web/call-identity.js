/**
 * Dedupe post-call analyses by recording / call identity (re-analyses count once).
 */

/** Stable key to dedupe re-analyses of the same call. */
export function callIdentityKey(record) {
  const zoom = record.zoomLink || record.result?.recordingUrl || "";
  if (zoom) {
    const match =
      zoom.match(/\/rec\/(?:share|play)\/([^/?#]+)/i) ||
      zoom.match(/recording[=/]([a-zA-Z0-9_-]+)/i);
    if (match) return `zoom:${match[1].toLowerCase()}`;
    return `zoomurl:${zoom.split("?")[0].trim().toLowerCase()}`;
  }
  const a = record.analysis || {};
  const title = (a.callHeader?.title || record.title || "").trim().toLowerCase();
  const date = (a.callHeader?.date || "").trim().toLowerCase();
  if (title && date) return `title:${title}|${date}`;
  if (title) return `title:${title}`;
  return `id:${record.id}`;
}

/** Keep newest analysis per call identity. */
export function dedupeAnalysesByCallIdentity(analyses) {
  const byKey = new Map();
  for (const rec of analyses) {
    const key = callIdentityKey(rec);
    const existing = byKey.get(key);
    if (!existing || (rec.timestamp || 0) > (existing.timestamp || 0)) {
      byKey.set(key, rec);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
