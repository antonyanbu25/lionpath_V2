/**
 * Unit tests for Pass 5 technical commit normalize + delta helpers (no LLM).
 */
import { normalizeCommitOutput, buildTcDeltaDrafts, runPostCallCommitWithProvider } from "../src/postcall/commit.ts";
import { TC_SLOT_KEYS } from "../src/domain-model/technical-commit.ts";
import type { LlmProvider, LlmRequest } from "../src/providers/types.ts";

const checks: [string, boolean][] = [];

const commit = normalizeCommitOutput({
  status: "at_risk",
  justification: "Security review of data residency is unresolved.",
  incumbent: { value: "Salesforce Service Cloud", evidence: "We run everything on Service Cloud today", surfaced: true },
  competitor: { value: "", evidence: "not surfaced", surfaced: false },
  identifiedRisk: { value: "EU data residency", evidence: "Our DPO will block anything hosted in the US", surfaced: true },
  timelineForClosure: { value: "Decision by end of Q3", evidence: "We want to sign before the quarter closes", surfaced: true },
  reasonForEvaluation: { value: "", evidence: "not surfaced", surfaced: false },
  whatsWorking: { value: "Omnichannel inbox", evidence: "The unified inbox is exactly what we wanted", surfaced: true },
  aiAttach: { surfaced: true, product: "Copilot", agentCount: 14, agentTotal: 14, optedInAfterDemo: true },
});

checks.push(
  ["status kept", commit.status === "at_risk"],
  ["justification kept", (commit.justification || "").includes("data residency")],
  ["surfaced slot kept", commit.incumbent?.value === "Salesforce Service Cloud"],
  ["unsurfaced slot is null", commit.competitor === null],
  ["all slot keys present", TC_SLOT_KEYS.every((k) => k in commit)],
  ["ai attach summary derived", commit.aiAttach?.summary === "Copilot 14/14"],
  ["opted in after demo preserved", commit.aiAttach?.optedInAfterDemo === true],
);

const noEvidence = normalizeCommitOutput({
  status: "yes",
  identifiedRisk: { value: "Might be a migration risk", evidence: "", surfaced: true },
  aiAttach: { surfaced: true },
});

checks.push(
  ["slot without evidence dropped", noEvidence.identifiedRisk === null],
  ["empty ai attach dropped", noEvidence.aiAttach === null],
);

const badStatus = normalizeCommitOutput({ status: "probably" });
checks.push(
  ["unknown status defaults to pending", badStatus.status === "pending"],
  ["absent justification is null", badStatus.justification === null],
);

// --- deltas -------------------------------------------------------------

const previous = {
  status: "pending" as const,
  incumbent: { value: "Salesforce Service Cloud", evidence: "prior call" },
  identifiedRisk: { value: "Budget approval", evidence: "prior call" },
  aiAttach: { product: "Copilot", agentCount: 10, agentTotal: 14, summary: "Copilot 10/14" },
};

const deltas = buildTcDeltaDrafts(previous, commit);
const byField = Object.fromEntries(deltas.map((d) => [d.field, d]));

checks.push(
  ["unchanged slot is confirmed", byField.incumbent?.changeType === "confirmed"],
  ["moved slot is changed", byField.identifiedRisk?.changeType === "changed"],
  ["previous value carried", (byField.identifiedRisk?.previous as { value: string })?.value === "Budget approval"],
  ["first-time slot is new", byField.timelineForClosure?.changeType === "new"],
  ["ai attach movement detected", byField.aiAttach?.changeType === "changed"],
  ["status movement emitted", byField.status?.changeType === "changed"],
  ["silent slot emits nothing", byField.competitor === undefined],
  ["delta evidence is the call quote", (byField.incumbent?.evidence || "").includes("Service Cloud")],
);

const firstCall = buildTcDeltaDrafts(null, commit);
checks.push(
  ["no prior snapshot means all new", firstCall.every((d) => d.changeType === "new")],
  ["first call still emits status", firstCall.some((d) => d.field === "status")],
);

const noMovement = buildTcDeltaDrafts(
  { status: "at_risk", incumbent: { value: "Salesforce Service Cloud", evidence: "prior" } },
  normalizeCommitOutput({
    status: "at_risk",
    incumbent: { value: "salesforce service cloud", evidence: "still on Service Cloud", surfaced: true },
  }),
);

checks.push(
  ["case-insensitive slot compare", noMovement.find((d) => d.field === "incumbent")?.changeType === "confirmed"],
  ["unchanged status emits no delta", !noMovement.some((d) => d.field === "status")],
);

const validRetryCommit = JSON.stringify({
  status: "yes",
  justification: "The buyer confirmed the technical path after reviewing the integration and data flow.",
  ...Object.fromEntries(
    TC_SLOT_KEYS.map((key) => [
      key,
      key === "incumbent"
        ? {
            value: "Zendesk",
            evidence: "We are moving off Zendesk if this integration works",
            surfaced: true,
          }
        : { value: "", evidence: "not surfaced", surfaced: false },
    ]),
  ),
  aiAttach: { surfaced: false },
});

const retryRequests: LlmRequest[] = [];
const retryProvider: LlmProvider = {
  async generate(req) {
    retryRequests.push(req);
    if (retryRequests.length === 1) {
      return {
        text: "not valid json",
        finishReason: "STOP",
        usage: {
          model: "mock",
          promptTokens: 100,
          outputTokens: 40,
          cachedTokens: 0,
          groundingQueries: 0,
          latencyMs: 1,
        },
      };
    }
    return {
      text: validRetryCommit,
      finishReason: "STOP",
      usage: {
        model: "mock",
        promptTokens: 100,
        outputTokens: 220,
        cachedTokens: 0,
        groundingQueries: 0,
        latencyMs: 1,
      },
    };
  },
};

const retryResult = await runPostCallCommitWithProvider(
  {},
  {
    transcript:
      "[00:01] SE: The integration uses the standard connector.\n[00:08] Customer: We are moving off Zendesk if this integration works.",
  },
  retryProvider,
);

checks.push(
  ["truncated first commit retries once", retryRequests.length === 2],
  ["retry uses larger token budget", retryRequests[1]?.maxTokens === 6000],
  ["retry carries attempt marker", retryRequests[1]?.retryAttempt === 1],
  [
    "retry prompt asks for complete concise JSON",
    retryRequests[1]?.user.includes("Produce the COMPLETE JSON") &&
      retryRequests[1]?.user.includes("justification field under 150 words"),
  ],
  ["retry result normalized", retryResult.technicalCommit.status === "yes"],
);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log(`All ${checks.length} postcall-commit checks passed.`);
