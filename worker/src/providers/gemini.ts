// Google Gemini adapter — uses GEMINI_API_KEY (same key from GCP / Google AI Studio).



import { toGeminiResponseSchema } from "../gemini-schema";
import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";



const DEFAULT_MODEL = "gemini-3.1-flash-lite";



interface GeminiPart {

  text?: string;

  thought?: boolean;

}



interface GeminiResponse {

  candidates?: { content?: { parts?: GeminiPart[] } }[];

  error?: { message?: string };

}



/** Keep answer text only — thinking parts must not be concatenated into JSON output. */

function extractAnswerText(parts: GeminiPart[]): string {

  const answerParts = parts.filter((p) => p.text && p.thought !== true);

  if (answerParts.length) return answerParts.map((p) => p.text as string).join("");



  // Fallback: last part that looks like JSON (some models omit the thought flag).

  for (let i = parts.length - 1; i >= 0; i--) {

    const t = parts[i].text?.trim();

    if (t && t.startsWith("{")) return t;

  }

  return parts.map((p) => p.text || "").join("");

}



export function geminiProvider(env: ProviderEnv, modelOverride?: string): LlmProvider {

  const model = modelOverride || env.MODEL || DEFAULT_MODEL;

  const apiKey = env.GEMINI_API_KEY;



  return {

    async generate(req: LlmRequest): Promise<LlmResult> {

      if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to worker/.dev.vars or wrangler secrets.");



      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;



      const generationConfig: Record<string, unknown> = {

        maxOutputTokens: req.maxTokens,

        temperature: req.research ? 0.4 : 0.2,

      };



      if (req.jsonSchema) {

        generationConfig.responseMimeType = "application/json";

        generationConfig.responseSchema = toGeminiResponseSchema(req.jsonSchema);

      }



      // Disable thinking for post-call speed on long transcripts, or when structured JSON is requested.

      if (

        req.thinkingBudget === 0 ||

        req.jsonSchema ||

        (!req.research && req.effort === "low")

      ) {

        generationConfig.thinkingConfig = { thinkingBudget: 0 };

      }



      const body: Record<string, unknown> = {

        systemInstruction: { parts: [{ text: req.system }] },

        contents: [{ role: "user", parts: [{ text: req.user }] }],

        generationConfig,

      };



      if (req.research) {

        body.tools = [{ google_search: {} }];

      }



      const res = await fetch(url, {

        method: "POST",

        headers: { "content-type": "application/json" },

        body: JSON.stringify(body),

      });

      if (!res.ok) {

        const errBody = await res.text();

        throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 500)}`);

      }



      const data = (await res.json()) as GeminiResponse;

      if (data.error?.message) throw new Error(data.error.message);



      const parts = data.candidates?.[0]?.content?.parts || [];

      const text = extractAnswerText(parts);

      if (!text) throw new Error("Gemini returned no text content.");

      return { text };

    },

  };

}

