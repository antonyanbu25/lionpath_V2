/** User feedback — per-user KV + global aggregate log. */

import { type HistoryBackend, type HistoryEnv, normalizeHistoryEmail } from "./history";
import {
  createFreshdeskTicket,
  createTicket,
  FRESHDESK_FIELD_ACCOUNT_ID,
  FRESHDESK_FIELD_AREA,
  FRESHDESK_FIELD_CALL_ID,
  FRESHDESK_FIELD_DEAL_ID,
  FRESHDESK_FIELD_PAGE_CONTEXT,
  FRESHDESK_FIELD_TYPE_SEVERITY,
  MAX_ATTACHMENT_BYTES,
  type FreshdeskEnv,
} from "./freshdesk";

export interface FeedbackPageContext {
  hash?: string;
  callId?: string;
  dealId?: string;
  accountId?: string;
  view?: string;
}

export interface FeedbackEntry {
  id: string;
  category: "Bug" | "Idea" | "Data quality" | string;
  message: string;
  page?: string;
  email?: string;
  createdAt: number;
  severity?: string;
  area?: string;
  priority?: string;
  context?: FeedbackPageContext;
  ticketId?: number | null;
  ticketError?: string | null;
}

export type FeedbackEnv = HistoryEnv & FreshdeskEnv;
export type FeedbackAttachment = { filename: string; contentType: string; bytes: Uint8Array };

const MAX_FEEDBACK = 100;
const MAX_GLOBAL = 500;
const GLOBAL_KEY = "feedback:global";

function resolveBackend(env: FeedbackEnv): HistoryBackend | null {
  if (env.HISTORY_BACKEND) return env.HISTORY_BACKEND;
  if (env.HISTORY_KV) return env.HISTORY_KV;
  return null;
}

export function feedbackStorageAvailable(env: FeedbackEnv): boolean {
  return !!resolveBackend(env);
}

function feedbackKey(email: string): string {
  return `feedback:${normalizeHistoryEmail(email)}`;
}

export async function loadFeedback(env: FeedbackEnv, email: string): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(feedbackKey(email));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

export async function loadGlobalFeedback(env: FeedbackEnv): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(GLOBAL_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendGlobal(env: FeedbackEnv, entry: FeedbackEntry): Promise<void> {
  const backend = resolveBackend(env);
  if (!backend) return;
  const list = await loadGlobalFeedback(env);
  const merged = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_GLOBAL);
  await backend.put(GLOBAL_KEY, JSON.stringify(merged));
}

const PRIORITY_LABELS: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };
const SEVERITY_KEYS: Record<string, string> = {
  "Critical — blocking work": "critical",
  "High — workable but painful": "high",
  "General — improvement": "general",
  "Minor — nice to have": "minor",
};
const AREA_KEYS: Record<string, string> = {
  "Pre-call prep": "pre-call-prep",
  "Post-call analysis": "post-call-analysis",
  Dashboard: "dashboard",
  "Accounts & deals": "accounts-deals",
  "Coaching / scorecards": "coaching-scorecards",
  Search: "search",
  "UI / visual": "ui-visual",
  "Performance / speed": "performance-speed",
  Other: "other",
};

export async function createJanusTicket(
  env: FeedbackEnv,
  entry: FeedbackEntry,
  attachment?: FeedbackAttachment | null,
): Promise<{ ticketId: number | null; error: string | null }> {
  if (!env.FRESHDESK_API_KEY || !env.FRESHDESK_DOMAIN) {
    const error = "not configured";
    console.warn(`[feedback] Freshdesk ticket skipped: ${error}`);
    return { ticketId: null, error };
  }
  try {
    if (attachment && attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      const error = `Attachment too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB).`;
      console.warn(`[feedback] Freshdesk ticket skipped: ${error}`);
      return { ticketId: null, error };
    }
    const context = entry.context || {};
    const severity = String(entry.severity || "General — improvement");
    const area = String(entry.area || "Other");
    const severityKey = SEVERITY_KEYS[severity] || severity.trim().toLowerCase();
    const areaKey = AREA_KEYS[area] || area.trim().toLowerCase();
    const priority = Math.min(4, Math.max(1, Number.parseInt(entry.priority || "2", 10) || 2));
    const hash = String(context.hash || entry.page || "");
    const dash = "—";
    const description = [
      `Category: ${entry.category}`,
      `Type/Severity: ${severity}`,
      `Area: ${area}`,
      `Priority: ${PRIORITY_LABELS[priority]}`,
      `SE: ${entry.email || ""}`,
      "",
      "--- Feedback ---",
      entry.message,
      "",
      "--- Page context ---",
      `View: ${context.view || dash}`,
      `Hash: ${hash || dash}`,
      `Call ID: ${context.callId || dash}`,
      `Deal ID: ${context.dealId || dash}`,
      `Account ID: ${context.accountId || dash}`,
    ].join("\n");
    const subject = `Portal Feedback: ${entry.category}`;
    const tags = ["portal-feedback", severityKey, areaKey];
    const custom_fields = {
      [FRESHDESK_FIELD_TYPE_SEVERITY]: severity,
      [FRESHDESK_FIELD_AREA]: area,
      [FRESHDESK_FIELD_CALL_ID]: context.callId || "",
      [FRESHDESK_FIELD_DEAL_ID]: context.dealId || "",
      [FRESHDESK_FIELD_ACCOUNT_ID]: context.accountId || "",
      [FRESHDESK_FIELD_PAGE_CONTEXT]: hash,
    };
    if (attachment) {
      const ticket = await createFreshdeskTicket(env, {
        subject,
        description,
        email: entry.email || "",
        priority,
        status: 2,
        type: "",
        tags,
        customFields: custom_fields,
        attachment,
      });
      return { ticketId: ticket.id, error: null };
    }
    const ticket = await createTicket(env, {
      subject,
      description,
      email: entry.email || "",
      priority,
      status: 2,
      tags,
      custom_fields,
    });
    return { ticketId: typeof ticket.id === "number" ? ticket.id : null, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[feedback] Freshdesk ticket failed: ${error}`);
    return { ticketId: null, error };
  }
}

export async function appendFeedback(
  env: FeedbackEnv,
  email: string,
  entry: FeedbackEntry,
  attachment?: FeedbackAttachment | null,
): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) {
    throw new Error("Feedback storage is not configured (missing HISTORY_KV or HISTORY_FILE_DIR).");
  }
  const withEmail: FeedbackEntry = { ...entry, email: entry.email || email };
  const ticket = await createJanusTicket(env, withEmail, attachment);
  withEmail.ticketId = ticket.ticketId;
  withEmail.ticketError = ticket.error;
  entry.ticketId = ticket.ticketId;
  entry.ticketError = ticket.error;
  const list = await loadFeedback(env, email);
  const merged = [withEmail, ...list.filter((e) => e.id !== withEmail.id)].slice(0, MAX_FEEDBACK);
  await backend.put(feedbackKey(email), JSON.stringify(merged));
  await appendGlobal(env, withEmail);
  return merged;
}

export function normalizeFeedbackCategory(raw: string): FeedbackEntry["category"] {
  const key = String(raw || "").trim().toLowerCase();
  if (key === "bug") return "Bug";
  if (key === "data" || key === "data quality") return "Data quality";
  if (raw === "Bug" || raw === "Idea" || raw === "Data quality") return raw;
  if (key === "other" || raw === "Other") return "Other";
  return "Idea";
}
