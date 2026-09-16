/**
 * Build Pass 9 summary batch items and persist results from Firestore context.
 */

import type { FirestoreDoc, FirestoreEnv } from "../data/firestore-admin";
import { getDoc, queryBy, setDoc } from "../data/firestore-admin";
import { newId } from "../domain-model/id";
import { extractJson } from "../json";
import type { SummaryDraft } from "../domain-model/summaries";
import type { BatchGenerateItem } from "../providers/gemini-batch";
import {
  formatAccountContext,
  formatDealContext,
  normalizeSummaryDraft,
  type AccountSummaryContext,
  type DealSummaryContext,
  type SummaryCallDigest,
} from "./summaries";

export interface SummariesBatchContext {
  dealId?: string | null;
  accountId: string;
  ownerId: string;
  teamId?: string;
  orgId?: string;
  userId?: string;
}

const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sourceCallIds"],
  properties: {
    summary: { type: "string" },
    sourceCallIds: { type: "array", maxItems: 80, items: { type: "string" } },
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

function formatCallDigestFromSummary(call: FirestoreDoc, dealLabel: string | null): SummaryCallDigest {
  const createdAt = Number(call.createdAt || 0);
  const date = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : null;
  return {
    callId: String(call.id),
    dealId: call.dealId ? String(call.dealId) : null,
    dealLabel,
    callType: call.callType ? String(call.callType) : null,
    date,
    callNotes: call.aiShortForm ? String(call.aiShortForm) : null,
    momentum: null,
    traction: null,
    openFollowUps: typeof call.followUpCount === "number" ? call.followUpCount : undefined,
    objections: typeof call.objectionCount === "number" ? call.objectionCount : undefined,
  };
}

function meddpiccSnapshotText(deal: FirestoreDoc, account: FirestoreDoc): string | null {
  const med = deal.meddpicc || account.meddpicc;
  if (!med || typeof med !== "object") return null;
  const parts: string[] = [];
  for (const [key, slot] of Object.entries(med as Record<string, { value?: string }>)) {
    const val = slot?.value?.trim();
    if (val) parts.push(`${key}: ${val}`);
  }
  return parts.length ? parts.join("; ") : null;
}

function technicalCommitSnapshotText(tc: FirestoreDoc | null): string | null {
  if (!tc) return null;
  const parts: string[] = [];
  if (tc.status) parts.push(`status=${String(tc.status)}`);
  const incumbent = tc.incumbent as { value?: string } | undefined;
  if (incumbent?.value) parts.push(`incumbent=${incumbent.value}`);
  const competitor = tc.competitor as { value?: string } | undefined;
  if (competitor?.value) parts.push(`competitor=${competitor.value}`);
  const aiAttach = tc.aiAttach as { summary?: string } | undefined;
  if (aiAttach?.summary) parts.push(`aiAttach=${aiAttach.summary}`);
  return parts.length ? parts.join("; ") : null;
}

/** Assemble Pass 9 worker input from Firestore (mirrors web summaries-service). */
export async function buildSummariesContextFromFirestore(
  dealId: string | null,
  accountId: string,
  env?: FirestoreEnv,
): Promise<{ deal: DealSummaryContext | null; account: AccountSummaryContext } | null> {
  const account = await getDoc("accounts", accountId, env);
  if (!account) return null;

  const deals = await queryBy("deals", [{ field: "accountId", op: "==", value: accountId }], undefined, 200, env);
  const dealLabelById = new Map(
    deals.map((d) => [String(d.id), String(d.title || d.type || "Deal")]),
  );

  const accountCallsRaw = await queryBy(
    "callSummaries",
    [{ field: "accountId", op: "==", value: accountId }],
    { field: "createdAt", direction: "asc" },
    80,
    env,
  );

  const accountCalls: SummaryCallDigest[] = accountCallsRaw.map((call) =>
    formatCallDigestFromSummary(
      call,
      call.dealId ? dealLabelById.get(String(call.dealId)) || null : null,
    ),
  );

  let dealContext: DealSummaryContext | null = null;
  const deal = dealId ? deals.find((d) => String(d.id) === dealId) || (await getDoc("deals", dealId, env)) : null;

  if (deal) {
    const dealCallsRaw = await queryBy(
      "callSummaries",
      [{ field: "dealId", op: "==", value: String(deal.id) }],
      { field: "createdAt", direction: "asc" },
      50,
      env,
    );
    const dealCalls = dealCallsRaw.map((call) =>
      formatCallDigestFromSummary(call, String(deal.title || deal.type || "Deal")),
    );

    const tcRows = await queryBy(
      "technicalCommits",
      [{ field: "dealId", op: "==", value: String(deal.id) }],
      undefined,
      1,
      env,
    );
    const tc = tcRows[0] || null;

    const signals = await queryBy(
      "dealSignals",
      [{ field: "dealId", op: "==", value: String(deal.id) }],
      { field: "createdAt", direction: "desc" },
      1,
      env,
    );
    let latestTraction: string | null = null;
    if (signals[0]?.traction) {
      const reasons = Array.isArray(signals[0].reasonsJson) ? (signals[0].reasonsJson as string[]) : [];
      latestTraction = `${String(signals[0].traction)}: ${reasons.slice(0, 2).join("; ")}`;
    }

    dealContext = {
      dealId: String(deal.id),
      dealTitle: String(deal.title || deal.type || "Deal"),
      dealType: String(deal.type || ""),
      stage: String(deal.stage || ""),
      accountName: String(account.name || ""),
      meddpiccSummary: meddpiccSnapshotText(deal, account),
      technicalCommitSummary: technicalCommitSnapshotText(tc),
      latestTraction,
      calls: dealCalls,
    };
  }

  return {
    deal: dealContext,
    account: {
      accountId,
      accountName: String(account.name || ""),
      deals: deals.map((d) => ({
        dealId: String(d.id),
        title: String(d.title || d.type || "Deal"),
        type: String(d.type || ""),
        stage: String(d.stage || ""),
        status: String(d.status || ""),
      })),
      calls: accountCalls,
    },
  };
}

/** Build batch items for deal + account summary regeneration. */
export function buildSummariesBatchItems(input: {
  deal: DealSummaryContext | null;
  account: AccountSummaryContext;
}): BatchGenerateItem[] {
  const items: BatchGenerateItem[] = [];

  if (input.deal?.dealId && input.deal.calls.length) {
    items.push({
      key: `deal:${input.deal.dealId}`,
      system: dealSummarySystemPrompt(),
      user: ["Rewrite the deal summary from this evidence.", "", formatDealContext(input.deal)].join("\n"),
      jsonSchema: SUMMARY_OUTPUT_SCHEMA,
      maxTokens: 3500,
    });
  }

  items.push({
    key: `account:${input.account.accountId}`,
    system: accountSummarySystemPrompt(),
    user: [
      "Rewrite the account summary from this evidence.",
      "",
      formatAccountContext(input.account),
    ].join("\n"),
    jsonSchema: SUMMARY_OUTPUT_SCHEMA,
    maxTokens: 3500,
  });

  return items;
}

export function parseSummaryBatchResult(text: string, maxWords: number): SummaryDraft {
  return normalizeSummaryDraft(extractJson(text), maxWords);
}

export async function persistSummaryDraftFromBatch(
  ctx: SummariesBatchContext,
  draft: SummaryDraft,
  kind: "deal" | "account",
  env?: FirestoreEnv,
): Promise<void> {
  if (!draft.summary?.trim()) return;
  const ts = Date.now();

  if (kind === "deal" && ctx.dealId) {
    const existingRows = await queryBy(
      "dealSummaries",
      [{ field: "dealId", op: "==", value: ctx.dealId }],
      undefined,
      1,
      env,
    );
    const existing = existingRows[0];
    await setDoc(
      "dealSummaries",
      existing ? String(existing.id) : newId("dealSummary"),
      {
        dealId: ctx.dealId,
        accountId: ctx.accountId,
        summary: draft.summary.trim(),
        generatedAt: ts,
        sourceCallIds: draft.sourceCallIds || [],
        ownerId: ctx.ownerId,
        teamId: ctx.teamId || "",
        orgId: ctx.orgId || "",
        createdAt: existing ? Number(existing.createdAt || ts) : ts,
        updatedAt: ts,
      },
      env,
    );
    return;
  }

  if (kind === "account" && ctx.accountId) {
    const existingRows = await queryBy(
      "accountSummaries",
      [{ field: "accountId", op: "==", value: ctx.accountId }],
      undefined,
      1,
      env,
    );
    const existing = existingRows[0];
    await setDoc(
      "accountSummaries",
      existing ? String(existing.id) : newId("accountSummary"),
      {
        accountId: ctx.accountId,
        summary: draft.summary.trim(),
        generatedAt: ts,
        sourceCallIds: draft.sourceCallIds || [],
        ownerId: ctx.ownerId,
        teamId: ctx.teamId || "",
        orgId: ctx.orgId || "",
        createdAt: existing ? Number(existing.createdAt || ts) : ts,
        updatedAt: ts,
      },
      env,
    );
  }
}

export function summariesIdempotencyKey(ctx: SummariesBatchContext): string {
  return `summaries:${ctx.accountId}:${ctx.dealId || "none"}`;
}
