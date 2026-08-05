// Provider factory. To add a provider: create ./<name>.ts exporting a function that returns an
// LlmProvider, then add a case here and set LLM_PROVIDER=<name> in wrangler.toml. Nothing else
// in the app needs to change.
//
// Web research is provider-specific:
//   - anthropic → server-side web_search / web_fetch tools (implemented)
//   - gemini    → map to the google_search grounding tool
//   - ollama    → no built-in web search; wire a separate search step or call with research:false

import type { FirestoreEnv } from "../data/firestore-admin";
import { recordLlmUsage } from "../data/llm-usage";
import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";

function wrapWithUsageRecording(provider: LlmProvider, fsEnv?: FirestoreEnv): LlmProvider {
  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      const result = await provider.generate(req);
      if (result.usage && req.userId) {
        recordLlmUsage(fsEnv, {
          userId: req.userId,
          callId: req.callId,
          passName: req.passName,
          ...result.usage,
        });
      }
      return result;
    },
  };
}

const RESEARCH_MODEL_FALLBACKS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];

export function resolveResearchModel(env: ProviderEnv): string {
  const explicit = env.RESEARCH_MODEL?.trim();
  if (explicit) return explicit;
  const model = env.MODEL?.trim();
  if (model && /^gemini-3\.[56]/i.test(model)) return model;
  return RESEARCH_MODEL_FALLBACKS[1];
}

export function resolveSynthesizeModel(env: ProviderEnv): string {
  const explicit = env.SYNTHESIZE_MODEL?.trim();
  if (explicit) return explicit;
  const research = env.RESEARCH_MODEL?.trim();
  if (research) return research;
  const model = env.MODEL?.trim();
  if (model) return model;
  return RESEARCH_MODEL_FALLBACKS[0];
}

export function getProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

/** Pre-call brief synthesis — may use a heavier Gemini model than extract/repair. */
export function getSynthesizeProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "gemini") {
    return wrapWithUsageRecording(geminiProvider(env, resolveSynthesizeModel(env)), env);
  }
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

/** Pre-call web research — may use a heavier Gemini model than synthesize/post-call. */
export function getResearchProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "gemini") {
    return wrapWithUsageRecording(geminiProvider(env, resolveResearchModel(env)), env);
  }
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

/** Post-call uses its own provider/model so it can differ from pre-call (e.g. faster model, no web search). */
export function getPostCallProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.POSTCALL_LLM_PROVIDER || env.LLM_PROVIDER || "gemini").toLowerCase();
  const model = env.POSTCALL_MODEL;
  if (provider === "gemini") return wrapWithUsageRecording(geminiProvider(env, model), env);
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

function resolveProvider(provider: string, env: ProviderEnv): LlmProvider {
  switch (provider) {
    case "anthropic":
      return anthropicProvider(env);
    case "gemini":
      return geminiProvider(env);
    case "ollama":
      throw new Error(
        "Ollama provider not implemented yet. Add worker/src/providers/ollama.ts implementing " +
          "LlmProvider. Ollama has no built-in web search — wire a separate search step or run with research:false.",
      );
    default:
      throw new Error(`Unknown LLM_PROVIDER "${env.LLM_PROVIDER}".`);
  }
}
