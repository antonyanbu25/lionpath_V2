#!/usr/bin/env tsx
/**
 * v2.3 — B4: runDeckValidation's docstring claims "Temperature 0" for deterministic
 * validation, but the provider.generate() call omitted `temperature`, silently inheriting
 * whatever the provider's default is (0.2). Locks in that the request actually sends
 * temperature: 0 so the docstring's claim stays true.
 */
import assert from "node:assert/strict";
import { runDeckValidation } from "../src/postcall/deck-validate.ts";
import type { PostCallDeckContent } from "../src/postcall/types.ts";

const originalFetch = globalThis.fetch;

const deckContent: PostCallDeckContent = {
  fileName: "deck.pdf",
  pageCount: 10,
  slides: [{ page: 1, text: "Agenda\nProduct overview\nPricing" }],
};

async function testSendsTemperatureZero() {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    isSlideDeck: true,
                    relevanceToCall: "high",
                    reason: "Matches company and topic.",
                    confidence: 0.9,
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    await runDeckValidation(
      { GEMINI_API_KEY: "test-key" },
      deckContent,
      { companyName: "Acme", meetingTitle: "Demo", transcriptSample: "SE: Hi.\nCustomer: Hello." },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody, "request body captured");
  const config = capturedBody!.generationConfig as Record<string, unknown> | undefined;
  assert.equal(config?.temperature, 0, "deck validation request sends temperature: 0");
  console.log("testSendsTemperatureZero: ok");
}

async function main() {
  await testSendsTemperatureZero();
  console.log("test-deck-validate-temperature: ok");
}

main().catch((err) => {
  globalThis.fetch = originalFetch;
  console.error(err);
  process.exit(1);
});
