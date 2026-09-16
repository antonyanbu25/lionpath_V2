/**
 * PII redaction for transcripts before LLM processing (NEW-4).
 *
 * When LLM_TRANSCRIPT_REDACTION=1, the worker redacts common PII patterns
 * (emails, phone numbers, credit card numbers) from the transcript text
 * before sending it to the LLM provider. This is best-effort regex-based
 * redaction — see docs/LLM_TRANSCRIPT_DPIA.md for limitations and the
 * recommended Vertex AI path for compliance-sensitive deployments.
 */

/** Redaction patterns — order matters (CC before phone to avoid partial matches). */
const REDACTION_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Credit card numbers (13-19 digits, optionally space/dash separated)
  { re: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[CC]" },
  // Email addresses
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // Phone numbers (US + international: +1, +44, etc.)
  { re: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, replacement: "[PHONE]" },
];

/**
 * Redact PII from text. Returns the original text when redaction is not
 * enabled (env flag absent or not "1"/"true").
 *
 * Accepts a loose env shape so it works with any Env type (ProviderEnv,
 * main Env, etc.) without a hard dependency on the full Env interface.
 */
export function redactTranscriptPii(
  text: string,
  env?: unknown,
): string {
  const flag = (
    ((env as Record<string, unknown> | undefined)?.LLM_TRANSCRIPT_REDACTION as string | undefined) || ""
  ).trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return text;
  let out = text;
  for (const { re, replacement } of REDACTION_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}