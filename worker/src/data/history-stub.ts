export function isHistoryStubId(id: unknown): boolean {
  const s = String(id || "");
  return s.startsWith("deal_hist_") || s.startsWith("hist_");
}
