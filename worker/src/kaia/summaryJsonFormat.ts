/**
 * Format Kaia summaryJson blocks for display (includes speaker names on list points).
 */

interface SummaryJsonItem {
  type?: string;
  name?: string;
  result?: {
    stringOutput?: string;
    listKeyPoints?: Array<{
      title?: string;
      points?: Array<{ text?: string; sources?: Array<{ speaker?: { name?: string } }> }>;
    }>;
  };
}

export function formatSummaryJson(jsonStr: string): string {
  let items: SummaryJsonItem[];
  try {
    items = JSON.parse(jsonStr) as SummaryJsonItem[];
  } catch {
    return jsonStr.trim();
  }
  if (!Array.isArray(items)) return jsonStr.trim();

  const parts: string[] = [];
  for (const item of items) {
    const name = item.name?.trim() || "Summary";
    if (item.result?.stringOutput?.trim()) {
      parts.push(`## ${name}\n${item.result.stringOutput.trim()}`);
    }
    if (item.result?.listKeyPoints?.length) {
      parts.push(`## ${name}`);
      for (const section of item.result.listKeyPoints) {
        if (section.title) parts.push(`### ${section.title}`);
        for (const pt of section.points || []) {
          if (!pt.text?.trim()) continue;
          const speaker = pt.sources?.[0]?.speaker?.name?.trim();
          parts.push(speaker ? `- ${pt.text.trim()} (${speaker})` : `- ${pt.text.trim()}`);
        }
      }
    }
  }
  return parts.join("\n\n").trim();
}
