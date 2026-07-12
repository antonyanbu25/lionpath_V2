// Anthropic (Claude) adapter. Maps research=true to the server-side web_search / web_fetch
// tools, sets output_config.effort, and drives the pause_turn server-tool loop. Returns the
// concatenated final text (a JSON object per the prep prompt).

import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_CONTINUATIONS = 8; // server-tool (pause_turn) loop cap

interface ContentBlock { type: string; text?: string; [k: string]: unknown }
interface AnthropicResponse {
  stop_reason?: string;
  content?: ContentBlock[];
}

export function anthropicProvider(env: ProviderEnv): LlmProvider {
  const model = env.MODEL || "claude-sonnet-5";
  const apiKey = env.ANTHROPIC_API_KEY;

  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

      const messages: { role: string; content: unknown }[] = [
        { role: "user", content: req.user },
      ];

      const base: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens,
        system: req.system,
      };
      if (req.effort) base.output_config = { effort: req.effort };
      if (req.research) {
        base.tools = [
          { type: "web_search_20260209", name: "web_search", max_uses: 4 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 1 },
        ];
      }

      let last: AnthropicResponse | null = null;
      for (let i = 0; i < MAX_CONTINUATIONS; i++) {
        const res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ ...base, messages }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
        }
        last = (await res.json()) as AnthropicResponse;

        if (last.stop_reason === "refusal") throw new Error("The model declined this request.");
        if (last.stop_reason === "pause_turn" && Array.isArray(last.content)) {
          messages.push({ role: "assistant", content: last.content });
          continue;
        }
        break;
      }

      if (!last || !Array.isArray(last.content)) throw new Error("Empty response from the model.");
      const text = last.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (!text) {
        // Self-diagnosing: max_tokens => raise maxTokens; pause_turn => research didn't
        // converge within MAX_CONTINUATIONS; anything else is unexpected.
        throw new Error(
          `Model produced no text (stop_reason: ${last.stop_reason ?? "unknown"}). ` +
            `If "max_tokens", increase maxTokens; if "pause_turn", research didn't finish in ${MAX_CONTINUATIONS} rounds.`,
        );
      }
      return { text };
    },
  };
}
