#!/usr/bin/env -S npx tsx
/** Verify postcall scorecard schema converts for Gemini and optionally hit API. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { QIP_PROFILES } from "../src/rubric-profiles.ts";
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";
import { runPostCallScorecard } from "../src/postcall/scorecard.ts";
import { debugLog } from "../src/debug-log.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDevVars() {
  try {
    const raw = readFileSync(join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // optional
  }
}

function scoreFieldEnum(schema) {
  const lines = schema.properties?.lines;
  const items = lines?.items;
  const props = items?.properties;
  const sub = props?.subParameters;
  const subItems = sub?.items;
  const subProps = subItems?.properties;
  const score = subProps?.score;
  return score?.enum;
}

async function main() {
  const demo = QIP_PROFILES.find((p) => p.key === "demo");
  if (!demo) throw new Error("demo profile missing");
  const themeKeys = demo.themes.map((t) => t.key);
  const rawSchema = {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subParameters: {
              type: "array",
              items: {
                type: "object",
                properties: { score: { type: "integer", enum: [0, 1, 2] } },
              },
            },
          },
        },
      },
    },
  };
  const gemini = toGeminiResponseSchema(rawSchema);
  const scoreEnum = scoreFieldEnum(gemini);
  debugLog({
    runId: "post-fix",
    hypothesisId: "A",
    location: "verify-postcall-schema.mjs",
    message: "converted score enum",
    data: { scoreEnum, ok: JSON.stringify(scoreEnum) === '["0","1","2"]' },
  });
  console.log("score enum:", scoreEnum);
  if (JSON.stringify(scoreEnum) !== '["0","1","2"]') {
    process.exit(1);
  }

  loadDevVars();
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY — schema check only (ok)");
    return;
  }

  const transcript =
    "[00:00] SE: Thanks for joining today.\n[00:05] Prospect: We need better ticket routing.\n";
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_LLM_PROVIDER: "gemini",
    POSTCALL_MODEL: "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: "low",
  };
  await runPostCallScorecard(env, {
    transcript,
    callType: "demo",
    videoAvailable: false,
  });
  debugLog({
    runId: "post-fix",
    hypothesisId: "A",
    location: "verify-postcall-schema.mjs",
    message: "live scorecard ok",
    data: { callType: "demo" },
  });
  console.log("Live scorecard OK");
}

main().catch((err) => {
  debugLog({
    runId: "post-fix",
    hypothesisId: "A",
    location: "verify-postcall-schema.mjs:error",
    message: "verification failed",
    data: { error: err instanceof Error ? err.message.slice(0, 500) : String(err) },
  });
  console.error(err);
  process.exit(1);
});
