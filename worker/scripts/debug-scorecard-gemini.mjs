#!/usr/bin/env -S npx tsx
/** One-shot debug: log scorecard Gemini request schema + full API error body. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { RUBRIC_PROFILES } from "../src/rubric-profiles.ts";
import { runPostCallScorecard } from "../src/postcall/scorecard.ts";
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function scorecardJsonSchema(themeKeys) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["lines", "analysisConfidence"],
    properties: {
      analysisConfidence: { type: "number", minimum: 0, maximum: 1 },
      lines: {
        type: "array",
        minItems: themeKeys.length,
        maxItems: themeKeys.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["themeKey", "score", "applicable", "confidence", "evidence", "coachingNote"],
          properties: {
            themeKey: { type: "string", enum: themeKeys },
            score: { type: "number", minimum: 0, maximum: 100 },
            applicable: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            notApplicableReason: { type: "string", nullable: true },
            evidence: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["quote"],
                properties: {
                  atS: { type: "number", nullable: true },
                  quote: { type: "string" },
                  source: {
                    type: "string",
                    enum: ["transcript", "video", "brief", "artifact"],
                    nullable: true,
                  },
                },
              },
            },
            coachingNote: { type: "string" },
          },
        },
      },
    },
  };
}

function countNodes(schema, depth = 0) {
  let count = 1;
  let maxDepth = depth;
  if (schema?.properties) {
    for (const v of Object.values(schema.properties)) {
      const sub = countNodes(v, depth + 1);
      count += sub.count;
      maxDepth = Math.max(maxDepth, sub.maxDepth);
    }
  }
  if (schema?.items) {
    const sub = countNodes(schema.items, depth + 1);
    count += sub.count;
    maxDepth = Math.max(maxDepth, sub.maxDepth);
  }
  return { count, maxDepth };
}

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

async function main() {
  loadDevVars();

  const fixtures = JSON.parse(
    readFileSync(join(ROOT, "testdata/consistency/fixtures.json"), "utf8"),
  );
  const fx = fixtures.find((f) => f.id === "demo-weak-feature-tour");
  const profile = RUBRIC_PROFILES.find((p) => p.callType === "demo");
  const themeKeys = profile.themes.map((t) => t.themeKey);
  const rawSchema = scorecardJsonSchema(themeKeys);
  const geminiSchema = toGeminiResponseSchema(rawSchema);
  const stats = countNodes(geminiSchema);

  const input = {
    transcript: fx.transcript,
    callType: "demo",
    videoAvailable: false,
    deckLink: null,
    briefContext: null,
    companyName: fx.companyName,
    meetingTitle: fx.meetingTitle,
  };

  console.log("=== SCHEMA ===");
  console.log("themes:", themeKeys.length);
  console.log("enum values:", themeKeys.join(", "));
  console.log("nodes after strip:", stats.count, "maxDepth:", stats.maxDepth);
  console.log("raw bytes:", JSON.stringify(rawSchema).length);
  console.log("gemini bytes:", JSON.stringify(geminiSchema).length);
  console.log(JSON.stringify(geminiSchema, null, 2));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY missing");
    process.exit(1);
  }

  const env = {
    GEMINI_API_KEY: apiKey,
    POSTCALL_LLM_PROVIDER: "gemini",
    POSTCALL_MODEL: "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: "low",
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === "string" && url.includes("generateContent")) {
      const body = JSON.parse(String(init?.body || "{}"));
      console.log("\n=== PRODUCTION REQUEST PAYLOAD (user truncated) ===");
      const debugBody = structuredClone(body);
      const userText = debugBody.contents?.[0]?.parts?.[0]?.text || "";
      debugBody.contents[0].parts[0].text =
        `${userText.slice(0, 400)}\n...[${userText.length} chars total]`;
      console.log(JSON.stringify(debugBody, null, 2));
    }
    const res = await origFetch(url, init);
    if (typeof url === "string" && url.includes("generateContent")) {
      const text = await res.text();
      console.log("\n=== API RESPONSE ===");
      console.log("status:", res.status);
      console.log("body:", text);
      return new Response(text, { status: res.status, headers: res.headers });
    }
    return res;
  };

  try {
    await runPostCallScorecard(env, input);
    console.log("\nSUCCESS — scorecard returned");
  } catch (err) {
    console.log("\nFAILED —", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    globalThis.fetch = origFetch;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
