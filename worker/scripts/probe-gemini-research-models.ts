/**
 * Probe Gemini models for google_search grounding support.
 * Usage: GEMINI_API_KEY=... tsx worker/scripts/probe-gemini-research-models.ts
 */

import { geminiProvider } from "../src/providers/gemini.ts";

const CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

async function probeModel(model: string, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  const env = {
    GEMINI_API_KEY: apiKey,
    RESEARCH_THINKING_LEVEL: "medium",
  };
  const provider = geminiProvider(env, model);
  try {
    const result = await provider.generate({
      system:
        "You are a research assistant. Run the web search implied by the user query and return a concise factual summary.",
      user: "Research query: Freshworks company headquarters location",
      maxTokens: 400,
      temperature: 0,
      research: true,
      effort: "low",
      step: `probe/${model}`,
    });
    const text = result.text.trim();
    if (!text) return { ok: false, detail: "empty response" };
    return { ok: true, detail: text.slice(0, 120).replace(/\s+/g, " ") };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 200) };
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set GEMINI_API_KEY to run the probe.");
    process.exit(1);
  }

  console.log("Probing Gemini research models (google_search + thinkingLevel=medium)...\n");
  let best: string | null = null;

  for (const model of CANDIDATES) {
    const { ok, detail } = await probeModel(model, apiKey);
    const status = ok ? "OK" : "FAIL";
    console.log(`${status}  ${model}`);
    console.log(`      ${detail}\n`);
    if (ok && !best) best = model;
  }

  if (!best) {
    console.error("No candidate model succeeded. Check API key and model access.");
    process.exit(1);
  }

  console.log(`Recommended: RESEARCH_MODEL=${best}`);
  console.log("Add to deploy/vps/.env and worker/wrangler.toml [vars].");
}

main();
