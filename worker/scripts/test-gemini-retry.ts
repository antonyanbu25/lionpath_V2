/**
 * Gemini retry + timeout helpers — unit tests (no network).
 * Usage: tsx worker/scripts/test-gemini-retry.ts
 */

import assert from "node:assert/strict";
import {
  GEMINI_TIMEOUT_MS,
  isGeminiSchemaErrorMessage,
  isNonRetryableGeminiHttpStatus,
  isRetryableGeminiHttpStatus,
  isRetryableNetworkError,
  parseRetryAfterMs,
  resolveGeminiTimeoutMs,
  resolveGeminiWorkload,
} from "../src/providers/gemini-retry.ts";
import type { LlmRequest } from "../src/providers/types.ts";

function req(partial: Partial<LlmRequest>): LlmRequest {
  return {
    system: "",
    user: "",
    maxTokens: 1000,
    passName: "extract-facts",
    ...partial,
  };
}

assert.equal(resolveGeminiWorkload(req({ research: true })), "research");
assert.equal(resolveGeminiWorkload(req({ passName: "synthesize" })), "synthesize");
assert.equal(resolveGeminiWorkload(req({ passName: "scorecard" })), "postcall");
assert.equal(resolveGeminiWorkload(req({ passName: "video/vision" })), "vision");
assert.equal(resolveGeminiWorkload(req({ passName: "extract-facts" })), "extraction");

assert.equal(resolveGeminiTimeoutMs(req({ research: true })), GEMINI_TIMEOUT_MS.research);
assert.equal(resolveGeminiTimeoutMs(req({ passName: "synthesize" })), GEMINI_TIMEOUT_MS.synthesize);
assert.equal(resolveGeminiTimeoutMs(req({ passName: "gaps" })), GEMINI_TIMEOUT_MS.postcall);

assert.equal(isRetryableGeminiHttpStatus(429), true);
assert.equal(isRetryableGeminiHttpStatus(503), true);
assert.equal(isRetryableGeminiHttpStatus(500), false);
assert.equal(isNonRetryableGeminiHttpStatus(400), true);
assert.equal(isNonRetryableGeminiHttpStatus(429), false);

assert.equal(
  isGeminiSchemaErrorMessage('Gemini API 400: INVALID_ARGUMENT responseSchema rejected'),
  true,
);
assert.equal(isGeminiSchemaErrorMessage("Gemini API 503: overloaded"), false);

assert.equal(isRetryableNetworkError(new TypeError("fetch failed")), true);
assert.equal(isRetryableNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" })), false);

const retryAfterHeader = new Headers({ "retry-after": "2" });
assert.equal(parseRetryAfterMs(retryAfterHeader), 2000);

console.log("test-gemini-retry: OK");
