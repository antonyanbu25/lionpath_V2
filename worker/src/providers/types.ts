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
  /** Vertex AI on GCP — used when GEMINI_API_KEY is unset (Cloud Run ADC). */
  GOOGLE_CLOUD_PROJECT?: string;
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  /** Optional — ZoomInfo person enrich fallback when LinkedIn/web search finds no experience data. */
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
  /** Gemini 2.5+ — set 0 to disable thinking for lower latency on long transcripts. */
  thinkingBudget?: number;
}

export interface LlmResult {
  text: string; // the model's final text (expected to be a JSON object for this app)
}

export interface LlmProvider {
  generate(req: LlmRequest): Promise<LlmResult>;
}
