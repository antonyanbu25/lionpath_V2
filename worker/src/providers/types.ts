// Provider-agnostic LLM interface. Swapping providers (Claude → Gemini → Ollama → …) means
// adding one adapter that implements LlmProvider and registering it in ./index.ts — the prep
// pipeline (prep.ts) never changes.

export interface ProviderEnv {
  LLM_PROVIDER?: string;
  MODEL?: string;
  EFFORT?: string;
  POSTCALL_LLM_PROVIDER?: string;
  POSTCALL_MODEL?: string;
  POSTCALL_EFFORT?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  ZOOMINFO_API_KEY?: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort?: string;
  research?: boolean;
  /** JSON Schema for structured output (Gemini responseSchema). */
  jsonSchema?: Record<string, unknown>;
  /** JSON response without responseSchema (Gemini responseMimeType only). */
  jsonMimeOnly?: boolean;
  /** Gemini 2.x — set 0 to disable thinking. On Gemini 3 this maps to thinkingLevel minimal. */
  thinkingBudget?: number;
  /** Override generation temperature (0 = deterministic). */
  temperature?: number;
  /** Prep pipeline step label — included in Gemini error messages for debugging. */
  step?: string;
}

export interface LlmResult {
  text: string; // the model's final text (expected to be a JSON object for this app)
}

export interface LlmProvider {
  generate(req: LlmRequest): Promise<LlmResult>;
}
