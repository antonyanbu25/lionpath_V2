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

// NEW-9 fix: cap the input size for JSON repair/parsing to prevent
// resource exhaustion if an LLM returns an unexpectedly large response.
// 256KB is generous for any structured JSON the model should produce;
// responses larger than this are likely malformed or adversarial.
const MAX_JSON_PARSE_BYTES = 256 * 1024;

export function extractJson<T>(text: string): T {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Model returned no text content to parse.");

  // NEW-9: cap the input before parsing/repairing to prevent DoS via
  // oversized LLM output (jsonrepair is O(n) regex work).
  const capped = trimmed.length > MAX_JSON_PARSE_BYTES
    ? trimmed.slice(0, MAX_JSON_PARSE_BYTES)
    : trimmed;

  const candidates = [
    capped,
    stripMarkdownFences(capped),
    isolateJsonObject(stripMarkdownFences(capped)),
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

  const preview = capped.length > 240 ? `${capped.slice(0, 120)}…${capped.slice(-120)}` : capped;
  throw new Error(
    `Could not parse JSON from model output: ${lastError?.message ?? "unknown error"}. Preview: ${preview}`,
  );
}
