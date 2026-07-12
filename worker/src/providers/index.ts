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

export function getProvider(env: ProviderEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "anthropic").toLowerCase();
  switch (provider) {
    case "anthropic":
      return anthropicProvider(env);
    case "gemini":
      throw new Error(
        "Gemini provider not implemented yet. Add worker/src/providers/gemini.ts implementing " +
          "LlmProvider (map research → google_search grounding) and register it in providers/index.ts.",
      );
    case "ollama":
      throw new Error(
        "Ollama provider not implemented yet. Add worker/src/providers/ollama.ts implementing " +
          "LlmProvider. Ollama has no built-in web search — wire a separate search step or run with research:false.",
      );
    default:
      throw new Error(`Unknown LLM_PROVIDER "${env.LLM_PROVIDER}".`);
  }
}
