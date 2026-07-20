/**
 * Validate prep vs post-call Gemini payloads against the live API.
 * Usage: GEMINI_API_KEY=... node scripts/test-prep-payloads.mjs
 *    or: key in worker/.dev.vars
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = "gemini-3.1-flash-lite";

function loadKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  const devVars = join(__dirname, "../.dev.vars");
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, "utf8").match(/GEMINI_API_KEY\s*=\s*["']?([^"'\s#]+)/);
    if (m) return m[1];
  }
  return null;
}

function buildBody({ research, jsonSchema, thinkingLevel }) {
  const generationConfig = {
    maxOutputTokens: research ? 800 : 600,
    temperature: research ? 0 : 0.2,
    thinkingConfig: { thinkingLevel },
  };
  if (jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = jsonSchema;
  }
  const body = {
    systemInstruction: { parts: [{ text: "You are a test assistant." }] },
    contents: [{ role: "user", parts: [{ text: research ? "Search: Acme Corp about page" : "Say OK" }] }],
    generationConfig,
  };
  if (research) body.tools = [{ google_search: {} }];
  return body;
}

const FACTS_SCHEMA_MIN = {
  type: "object",
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "value"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

async function probe(label, body) {
  const key = loadKey();
  if (!key) {
    console.log("NO_KEY — set GEMINI_API_KEY or worker/.dev.vars");
    process.exit(1);
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const status = res.ok ? "OK" : `FAIL ${res.status}`;
  console.log(`${label}: ${status} ${text.slice(0, 180).replace(/\s+/g, " ")}`);
  return res.ok;
}

const cases = [
  ["postcall (minimal + schema)", buildBody({ research: false, jsonSchema: FACTS_SCHEMA_MIN, thinkingLevel: "minimal" })],
  ["research (minimal + google_search)", buildBody({ research: true, jsonSchema: null, thinkingLevel: "minimal" })],
  ["research (low + google_search)", buildBody({ research: true, jsonSchema: null, thinkingLevel: "low" })],
  ["research (no thinkingConfig)", (() => {
    const b = buildBody({ research: true, jsonSchema: null, thinkingLevel: "minimal" });
    delete b.generationConfig.thinkingConfig;
    return b;
  })()],
];

let failed = 0;
for (const [label, body] of cases) {
  if (!(await probe(label, body))) failed++;
}

process.exit(failed ? 1 : 0);
