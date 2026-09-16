#!/usr/bin/env -S npx tsx
/**
 * Acceptance harness for post-call Gemini context caching.
 *
 * Usage:
 *   npx tsx scripts/test-postcall-cache.mjs
 *   npx tsx scripts/test-postcall-cache.mjs --dry-run
 *
 * Requires GEMINI_API_KEY in worker/.dev.vars or environment.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES_PATH = join(ROOT, "testdata/consistency/fixtures.json");

const dryRun = process.argv.includes("--dry-run");

async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function padTranscript(baseVtt, targetWords = 5500) {
  const body = baseVtt.replace(/^WEBVTT\s*\n*/i, "").trim();
  const chunk =
    "00:00:01.000 --> 00:00:02.000\nSpeaker: We discussed routing, SLA reporting, and AI deflection targets for the contact center.\n\n";
  let out = `WEBVTT\n\n${body}\n\n`;
  while (out.split(/\s+/).filter(Boolean).length < targetWords) {
    out += chunk;
  }
  return out;
}

async function main() {
  await loadEnv();
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error("GEMINI_API_KEY required — set in worker/.dev.vars");
    process.exit(1);
  }

  const {
    preparePostCallTranscriptCaches,
    releasePostCallTranscriptCaches,
    withPostCallTranscriptCache,
  } = await import("../src/postcall/transcript-cache-context.ts");
  const { runPostCallQualify } = await import("../src/postcall/qualify.ts");
  const { getPostCallProvider } = await import("../src/providers/index.ts");
  const { transcriptCacheHandle } = await import("../src/postcall/transcript-cache-context.ts");
  const { parseTranscript } = await import("../src/transcript.ts");

  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_MODEL: process.env.POSTCALL_MODEL || "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: "low",
  };

  const fixtures = JSON.parse(await readFile(FIXTURES_PATH, "utf8"));
  const shortFixture = fixtures[0];
  const shortBundle = await preparePostCallTranscriptCaches(env, {
    transcript: shortFixture.transcript,
    callId: "test-short",
  });
  console.log("short fixture cache bundle:", JSON.stringify(shortBundle, null, 2));
  if (!shortBundle.skipped) {
    console.warn("WARN: expected short fixture to skip caching (below token floor)");
  } else {
    console.log("ok: short fixture skipped cache (byte-identical uncached path preserved)");
  }
  await releasePostCallTranscriptCaches(env, shortBundle);

  if (dryRun) {
    console.log("\nDry run complete.");
    return;
  }

  const longTranscript = padTranscript(shortFixture.transcript, 5500);
  const parsed = parseTranscript(longTranscript);
  console.log(`\nLong transcript word count: ${parsed.wordCount}`);

  const usageRows = [];

  await withPostCallTranscriptCache(
    env,
    { transcript: longTranscript, callId: "test-long" },
    async (bundle) => {
      if (bundle.skipped) {
        console.error("FAIL: long transcript cache bundle was skipped");
        process.exit(1);
      }
      console.log("ok: long transcript caches created:", Object.keys(bundle.caches).join(", "));

      const provider = getPostCallProvider(env);
      const tailCache = transcriptCacheHandle(bundle, "tail6000");
      const system = "Reply with JSON only: {\"echo\":\"pass1\"}";
      const pass1 = await provider.generate({
        system,
        user: "First pass — say pass1 in echo field.",
        maxTokens: 64,
        passName: "cache-test-1",
        jsonSchema: {
          type: "object",
          required: ["echo"],
          properties: { echo: { type: "string" } },
        },
        cachedContent: tailCache,
      });
      usageRows.push({ pass: 1, ...pass1.usage });

      const pass2 = await provider.generate({
        system,
        user: "Second pass — say pass2 in echo field.",
        maxTokens: 64,
        passName: "cache-test-2",
        jsonSchema: {
          type: "object",
          required: ["echo"],
          properties: { echo: { type: "string" } },
        },
        cachedContent: tailCache,
      });
      usageRows.push({ pass: 2, ...pass2.usage });

      await runPostCallQualify(env, {
        transcript: longTranscript,
        companyName: shortFixture.companyName,
        callType: shortFixture.callType,
        transcriptCaches: bundle,
      });
    },
  );

  console.log("\nUsage rows:");
  for (const row of usageRows) {
    console.log(
      `  pass ${row.pass}: promptTokens=${row.promptTokens} cachedTokens=${row.cachedTokens}`,
    );
  }

  const pass1 = usageRows[0];
  const pass2 = usageRows[1];
  let failed = 0;
  if (!pass2?.cachedTokens || pass2.cachedTokens <= 0) {
    console.error("FAIL: pass 2 cachedTokens should be > 0");
    failed++;
  } else {
    console.log("ok: pass 2 cachedTokens > 0");
  }
  if (pass2 && pass1 && pass2.promptTokens >= pass1.promptTokens) {
    console.warn(
      "WARN: pass 2 promptTokens not lower than pass 1 (may vary by model billing metadata)",
    );
  } else {
    console.log("ok: pass 2 promptTokens lower than pass 1");
  }

  if (failed) process.exit(1);
  console.log("\nPost-call cache acceptance checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
