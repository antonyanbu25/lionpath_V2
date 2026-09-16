import { readFileSync } from "fs";

const vars = readFileSync(".dev.vars", "utf8");
const m = vars.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\s]+)/);
if (!m) {
  console.log("NO_KEY");
  process.exit(1);
}
const key = m[1];
const models = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
];

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const isGemini3 = /^gemini-3/i.test(model);
  const body = {
    contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
    generationConfig: {
      maxOutputTokens: 10,
      thinkingConfig: isGemini3 ? { thinkingLevel: "minimal" } : { thinkingBudget: 0 },
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`${model}: ${res.ok ? "OK" : `FAIL ${res.status} ${text.slice(0, 120)}`}`);
  } catch (e) {
    console.log(`${model}: ERR ${e.message}`);
  }
}
