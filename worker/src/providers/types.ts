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
  RESEARCH_MODEL?: string;
  RESEARCH_THINKING_LEVEL?: string;
  SYNTHESIZE_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  ZOOMINFO_API_KEY?: string;
  /** Post-call Gemini cachedContents TTL in seconds (default 900). */
  POSTCALL_CACHE_TTL_SECONDS?: string;
}

/** Token and latency stats returned by provider adapters. */
export interface LlmUsage {
  model: string;
  promptTokens: number;
  outputTokens: number;
  cachedTokens: number;
  groundingQueries: number;
  latencyMs: number;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Pipeline pass label for usage aggregation (e.g. "research", "scorecard"). */
  passName: string;
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
  /** Firestore usage attribution — set by route handlers when available. */
  userId?: string;
  callId?: string;
  /** Gemini cachedContents resource name — transcript prefix cached per call. */
  cachedContent?: string;
  /** Gemini cachedContents for static system/rubric — used instead of inline systemInstruction. */
  cachedSystemContent?: string;
}

/** A raw grounding citation as returned by a provider's web-search tool (e.g. Gemini groundingMetadata). */
export interface Citation {
  uri: string;
  /** Some providers return a short-lived redirect in `uri` and the real publisher URL here. */
  resolvedUrl?: string;
  title?: string;
  snippet?: string;
}

export interface LlmResult {
  text: string; // the model's final text (expected to be a JSON object for this app)
  /** Present only when the request set `research: true` and the provider grounded its answer. */
  citations?: Citation[];
  /** The web-search queries the provider actually ran, when it exposes them. */
  searchQueries?: string[];
  /**
   * Google Search Suggestions HTML from groundingMetadata.searchEntryPoint. Google's
   * grounding terms require displaying this alongside grounded results, so it is carried
   * rather than discarded at the provider boundary.
   */
  searchEntryPointHtml?: string;
  /** Present when the provider returned token usage metadata. */
  usage?: LlmUsage;
}

export interface LlmProvider {
  generate(req: LlmRequest): Promise<LlmResult>;
}
