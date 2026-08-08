// Provider factory. To add a provider: create ./<name>.ts exporting a function that returns an
// LlmProvider, then add a case here and set LLM_PROVIDER=<name> in wrangler.toml. Nothing else
// in the app needs to change.
//
// Web research is provider-specific:
//   - anthropic → server-side web_search / web_fetch tools (implemented)
//   - gemini    → map to the google_search grounding tool
//   - ollama    → no built-in web search; wire a separate search step or call with research:false

import type { CostControlEnv } from "../cost-control-config";
import type { FirestoreEnv } from "../data/firestore-admin";
import { recordLlmUsage } from "../data/llm-usage";
import { reserveDailyTokenBudget, totalTokens } from "../data/token-budget";
import { logInfo } from "../logger";
import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import {
  type PrepPassName,
  resolveDefaultModel,
  resolvePassModel,
  resolvePostCallModel,
  resolveResearchModel,
  resolveSynthesizeModel,
} from "./pass-models";

type ProviderFsEnv = FirestoreEnv & CostControlEnv;

function wrapWithUsageRecording(provider: LlmProvider, fsEnv?: ProviderFsEnv): LlmProvider {
  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      const settleBudget = await reserveDailyTokenBudget(fsEnv, req.userId);
      try {
        const result = await provider.generate(req);
        if (req.userId) {
          const used = result.usage ? totalTokens(result.usage.promptTokens, result.usage.outputTokens) : 0;
          await settleBudget(used);
          if (result.usage) {
            recordLlmUsage(fsEnv, {
              userId: req.userId,
              callId: req.callId,
              passName: req.passName,
              cacheHit: req.cacheHit,
              retryCount: result.usage.retryCount ?? 0,
              ...result.usage,
            });
          }
        }
        return result;
      } catch (err) {
        await settleBudget(0);
        throw err;
      }
    },
  };
}

export {
  DEFAULT_MODEL,
  PREMIUM_MODEL,
  PREP_PASS_MODELS,
  resolveDefaultModel,
  resolvePassModel,
  resolvePostCallModel,
  resolveResearchModel,
  resolveSynthesizeModel,
} from "./pass-models";
export type { PassModelConfig, PassTier, PrepPassName } from "./pass-models";

/** Log resolved models once at worker startup (Cloud Run / VPS logs). */
export function logResolvedModels(env: ProviderEnv): void {
  const visionModel = resolvePostCallModel(env);
  logInfo("[llm] resolved models", {
    MODEL: resolveDefaultModel(env),
    RESEARCH_MODEL: resolveResearchModel(env),
    SYNTHESIZE_MODEL: resolveSynthesizeModel(env),
    POSTCALL_MODEL: resolvePostCallModel(env),
    VISION_MODEL: visionModel,
  });
}

export function getProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

/** Pre-call pass-specific provider — reads model from PREP_PASS_MODELS table. */
export function getProviderForPass(
  passName: PrepPassName,
  env: ProviderEnv & FirestoreEnv,
): LlmProvider {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "gemini") {
    return wrapWithUsageRecording(geminiProvider(env, resolvePassModel(passName, env)), env);
  }
  return wrapWithUsageRecording(resolveProvider(provider, env), env);
}

/** Pre-call brief synthesis — may use a heavier Gemini model than extract/repair. */
export function getSynthesizeProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  return getProviderForPass("synthesize", env);
}

/** Pre-call web research — may use a heavier Gemini model than synthesize/post-call. */
export function getResearchProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  return getProviderForPass("research", env);
}

/** Stable seed from pass + prompt so identical inputs get identical Gemini sampling. */
function postcallSeedFromPrompt(passName: string, user: string): number {
  const basis = `${passName}\0${user}`;
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Gemini generationConfig.seed must be signed INT32.
  const unsigned = h >>> 0;
  return (unsigned % 2_147_483_647) || 1;
}

/** Post-call uses its own provider/model so it can differ from pre-call (e.g. faster model, no web search). */
export function getPostCallProvider(env: ProviderEnv & FirestoreEnv): LlmProvider {
  const provider = (env.POSTCALL_LLM_PROVIDER || env.LLM_PROVIDER || "gemini").toLowerCase();
  const model = resolvePostCallModel(env);
  const inner =
    provider === "gemini"
      ? wrapWithUsageRecording(geminiProvider(env, model), env)
      : wrapWithUsageRecording(resolveProvider(provider, env), env);
  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      const retryAttempt = req.retryAttempt ?? 0;
      const baseSeed = req.seed ?? postcallSeedFromPrompt(req.passName, req.user);
      const seed = retryAttempt > 0 ? baseSeed + retryAttempt * 7919 : baseSeed;
      const temperature = retryAttempt > 0 ? Math.max(0.15, req.temperature ?? 0) : req.temperature ?? 0;
      const result = await inner.generate({
        ...req,
        retryAttempt,
        temperature,
        seed,
      });
      if (retryAttempt > 0) {
        logInfo("[postcall-llm] retry complete", {
          passName: req.passName,
          retryAttempt,
          seed,
          temperature,
          finishReason: result.finishReason ?? "unknown",
          outputTokens: result.usage?.outputTokens ?? 0,
        });
      }
      return result;
    },
  };
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
