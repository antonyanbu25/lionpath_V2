/**
 * Pass 9 — Deal summary + account summary (spec §5, §11.5–§11.6).
 *
 * Evidence-grounded AI writes: summaries restate what was said on calls only.
 * They persist to dealSummaries / accountSummaries — never to Account or Deal CRM fields.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import type { SummaryDraft } from "../domain-model/summaries";
import { trimWords } from "../word-limits";

export type Env = ProviderEnv;

export interface SummaryCallDigest {
  callId: string;
  dealId?: string | null;
  dealLabel?: string | null;
  callType?: string | null;
  date?: string | null;
  callNotes?: string | null;
  momentum?: string | null;
  traction?: string | null;
  openFollowUps?: number;
  objections?: number;
}

export interface DealSummaryContext {
  dealId: string;
  dealTitle: string;
  dealType: string;
  stage: string;
  accountName: string;
  meddpiccSummary?: string | null;
  technicalCommitSummary?: string | null;
  latestTraction?: string | null;
  calls: SummaryCallDigest[];
}

export interface AccountSummaryContext {
  accountId: string;
  accountName: string;
  deals: Array<{
    dealId: string;
    title: string;
    type: string;
    stage: string;
    status: string;
  }>;
  calls: SummaryCallDigest[];
}

export interface PostCallSummariesInput {
  deal?: DealSummaryContext | null;
  account: AccountSummaryContext;
}

export interface PostCallSummariesResult {
  dealSummary: SummaryDraft | null;
  accountSummary: SummaryDraft;
}

const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sourceCallIds"],
  properties: {
    summary: { type: "string" },
    sourceCallIds: {
      type: "array",
      maxItems: 80,
      items: { type: "string" },
    },
  },
};

function dealSummarySystemPrompt(): string {
  return `You rewrite the DEAL summary for a Solution Engineering pursuit.

This summary replaces stale human-typed deal notes — it must always reflect every call on THIS deal.

Voice: concise narrative for an SE or manager scanning the deal record before a call.
Cover: pursuit status, what each call moved, qualification signals (MEDDPICC/TC when provided),
open commitments, risks, and the recommended focus for the next conversation.

Rules — evidence-grounded writes (mandatory):
- Only include facts supported by the call digests below (call notes, momentum, traction, follow-ups).
- Do NOT invent attendees, dates, ARR, or CRM fields not present in the input.
- Do NOT restate human CRM metadata as new facts — synthesize call evidence only.
- When a theme was never discussed on any call, omit it — do not speculate.
- Flag cross-deal product mentions only if they appear in these deal-scoped calls.

Output JSON only: { summary, sourceCallIds }.
- summary: max ~320 words, narrative paragraphs (not bullet CRM paste).
- sourceCallIds: every callId whose evidence you used (subset of input callIds).`;
}

function accountSummarySystemPrompt(): string {
  return `You rewrite the ACCOUNT summary spanning EVERY call across EVERY deal on this account.

This is the cross-sell lens — invisible from a single deal list. The second product is often
mentioned once on a call and never followed up; surface that pattern when call evidence shows it.

Voice: concise narrative for an SE or manager opening the account record.
Cover: account-level story across all deals, chronological call arc, products in play,
cross-deal gaps (mentioned once, never followed up), relationship health, and what needs attention.

Rules — evidence-grounded writes (mandatory):
- Only include facts supported by the call digests below.
- Do NOT invent firmographics, ARR, region, or CRM fields not in the input.
- Do NOT overwrite human account metadata — this generated summary lives separately.
- Highlight cross-deal and cross-product signals when evidenced (spec §11.5).
- When only one deal exists, still write an account-level arc (not a copy of the deal summary).

Output JSON only: { summary, sourceCallIds }.
- summary: max ~400 words, narrative paragraphs.
- sourceCallIds: every callId whose evidence you used (subset of input callIds).`;
}

function formatCallDigest(c: SummaryCallDigest): string {
  const lines = [
    `- callId: ${c.callId}`,
    c.date ? `  date: ${c.date}` : null,
    c.dealLabel ? `  deal: ${c.dealLabel}` : null,
    c.callType ? `  type: ${c.callType}` : null,
    c.momentum ? `  momentum: ${c.momentum}` : null,
    c.traction ? `  traction: ${c.traction}` : null,
    c.openFollowUps != null ? `  open follow-ups: ${c.openFollowUps}` : null,
    c.objections != null ? `  objections: ${c.objections}` : null,
    c.callNotes?.trim() ? `  notes: ${trimWords(c.callNotes, 120)}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function formatDealContext(deal: DealSummaryContext): string {
  const lines = [
    `Deal: ${deal.dealTitle} (${deal.dealType}, stage ${deal.stage})`,
    `Account: ${deal.accountName}`,
    deal.meddpiccSummary ? `MEDDPICC snapshot: ${deal.meddpiccSummary}` : null,
    deal.technicalCommitSummary ? `Technical commit snapshot: ${deal.technicalCommitSummary}` : null,
    deal.latestTraction ? `Latest traction: ${deal.latestTraction}` : null,
    "",
    `Calls on this deal (${deal.calls.length}):`,
    ...deal.calls.map(formatCallDigest),
  ];
  return lines.filter((l) => l !== null).join("\n");
}

function formatAccountContext(account: AccountSummaryContext): string {
  const dealLines = account.deals.map(
    (d) => `- ${d.title || d.type} (${d.type}, ${d.stage}, ${d.status}) [${d.dealId}]`,
  );
  const lines = [
    `Account: ${account.accountName} [${account.accountId}]`,
    "",
    `Deals on account (${account.deals.length}):`,
    ...(dealLines.length ? dealLines : ["- none"]),
    "",
    `All calls chronologically (${account.calls.length}):`,
    ...account.calls.map(formatCallDigest),
  ];
  return lines.join("\n");
}

export function normalizeSummaryDraft(raw: unknown, maxWords: number): SummaryDraft {
  let summary = "";
  /** @type {string[]} */
  let sourceCallIds: string[] = [];

  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    summary = trimWords(String(r.summary || ""), maxWords);
    if (Array.isArray(r.sourceCallIds)) {
      sourceCallIds = r.sourceCallIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .slice(0, 80);
    }
  }

  return { summary, sourceCallIds };
}

async function generateSummaryJson(
  env: Env,
  opts: {
    system: string;
    user: string;
    maxWords: number;
    step: string;
  },
): Promise<SummaryDraft> {
  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 3500,
    system: opts.system,
    user: opts.user,
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
      jsonSchema: SUMMARY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      step: opts.step,
      passName: "summaries",
    });
  return normalizeSummaryDraft(extractJson(result.text), opts.maxWords);
}

/**
 * Pass 9 entry — separate model calls for deal (when scoped) and account roll-ups.
 */
export async function runPostCallSummaries(
  env: Env,
  input: PostCallSummariesInput,
): Promise<PostCallSummariesResult> {
  if (!input.account?.accountId) {
    throw Object.assign(new Error("account context is required."), { status: 400 });
  }

  const accountUser = [
    "Rewrite the account summary from this evidence.",
    "",
    formatAccountContext(input.account),
  ].join("\n");

  const tasks: [Promise<SummaryDraft | null>, Promise<SummaryDraft>] = [
    input.deal?.dealId && input.deal.calls.length
      ? generateSummaryJson(env, {
          system: dealSummarySystemPrompt(),
          user: [
            "Rewrite the deal summary from this evidence.",
            "",
            formatDealContext(input.deal),
          ].join("\n"),
          maxWords: 320,
          step: "postcall-summaries-deal",
        })
      : Promise.resolve(null),
    generateSummaryJson(env, {
      system: accountSummarySystemPrompt(),
      user: accountUser,
      maxWords: 400,
      step: "postcall-summaries-account",
    }),
  ];

  const [dealSummary, accountSummary] = await Promise.all(tasks);

  return {
    dealSummary,
    accountSummary,
  };
}
