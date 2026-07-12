// Provider-agnostic LLM interface. Swapping providers (Claude → Gemini → Ollama → …) means
// adding one adapter that implements LlmProvider and registering it in ./index.ts — the prep
// pipeline (prep.ts) never changes.

export interface ProviderEnv {
  LLM_PROVIDER?: string; // "anthropic" (default) | "gemini" | "ollama" | ...
  MODEL?: string; // provider-specific model id, e.g. "claude-sonnet-5"
  EFFORT?: string; // "low" | "medium" | "high" | "xhigh" | "max" (providers that support it)
  ANTHROPIC_API_KEY?: string;
  // Future provider credentials (add as needed):
  // GEMINI_API_KEY?: string;
  // OLLAMA_BASE_URL?: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort?: string; // ignored by providers that don't support it
  research?: boolean; // enable web research if the provider supports it
}

export interface LlmResult {
  text: string; // the model's final text (expected to be a JSON object for this app)
}

export interface LlmProvider {
  generate(req: LlmRequest): Promise<LlmResult>;
}
