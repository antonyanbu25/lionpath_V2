function stripMarkdownFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function isolateJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

export function extractJson<T>(text: string): T {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Model returned no text content to parse.");

  const candidates = [
    trimmed,
    stripMarkdownFences(trimmed),
    isolateJsonObject(stripMarkdownFences(trimmed)),
  ];
  const unique = [...new Set(candidates.filter(Boolean))];

  let lastError: Error | null = null;
  for (const raw of unique) {
    for (const candidate of [raw, repairJson(raw)]) {
      try {
        return JSON.parse(candidate) as T;
      } catch (e) {
        lastError = e as Error;
      }
    }
  }

  const preview = trimmed.length > 240 ? `${trimmed.slice(0, 120)}…${trimmed.slice(-120)}` : trimmed;
  throw new Error(
    `Could not parse JSON from model output: ${lastError?.message ?? "unknown error"}. Preview: ${preview}`,
  );
}
