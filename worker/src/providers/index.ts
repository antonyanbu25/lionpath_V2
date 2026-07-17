// Provider factory. To add a provider: create ./<name>.ts exporting a function that returns an
// LlmProvider, then add a case here and set LLM_PROVIDER=<name> in wrangler.toml. Nothing else
// in the app needs to change.
//
// Web research is provider-specific:
//   - anthropic → server-side web_search / web_fetch tools (implemented)
//   - gemini    → map to the google_search grounding tool
//   - ollama    → no built-in web search; wire a separate search step or call with research:false

import type { LlmProvider, ProviderEnv } from "./types";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";

const GEMINI_ALIASES = new Set(["gemini", "vertex", "gemini-vertex"]);

export function getProvider(env: ProviderEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  return resolveProvider(provider, env);
}

/** Post-call uses its own provider/model so it can differ from pre-call (e.g. faster model, no web search). */
export function getPostCallProvider(env: ProviderEnv): LlmProvider {
  const provider = (env.POSTCALL_LLM_PROVIDER || env.LLM_PROVIDER || "gemini").toLowerCase();
  const model = env.POSTCALL_MODEL;
  if (GEMINI_ALIASES.has(provider)) return geminiProvider(env, model);
  return resolveProvider(provider, env);
}

function resolveProvider(provider: string, env: ProviderEnv): LlmProvider {
  switch (provider) {
    case "anthropic":
      return anthropicProvider(env);
    case "gemini":
    case "vertex":
    case "gemini-vertex":
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
