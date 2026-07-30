/** Redact share tokens from user-visible error strings. */
export function sanitizeKaiaUrlForDisplay(input: string): string {
  return String(input || "").replace(
    /(\/kaia\/share\/)([^/?#\s]+)/gi,
    "$1[redacted]",
  );
}

export function sanitizeErrorMessage(message: string): string {
  return sanitizeKaiaUrlForDisplay(message);
}
