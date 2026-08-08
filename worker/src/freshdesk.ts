/** Freshdesk Support API — create tickets for score disputes + product feedback.
 *
 * Env (server-side only — never expose to the browser):
 *   FRESHDESK_API_KEY   — API key (Basic auth username; password is "X")
 *   FRESHDESK_DOMAIN    — e.g. "janus.freshdesk.com" or "janus"
 *
 * Docs: https://developer.freshdesk.com/api/#create_ticket
 *
 * Janus ticket fields (verified via /api/v2/ticket_fields):
 *   type → "Dispute of score" | "Feature Request" | …
 *   custom_fields.cf_issue_type → Score too low | Score too high | …
 *   custom_fields.cf_call_id, cf_page_context_hash, cf_area_of_the_product, …
 */

export interface FreshdeskEnv {
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
}

/** Ticket Type choices configured on janus.freshdesk.com */
export const FRESHDESK_TICKET_TYPE = {
  disputeScore: "Dispute of score",
  /** Janus has no "Feedback" type — Feature Request is the closest portal type. */
  feedback: "Feature Request",
} as const;

/** Exact dropdown labels for custom field `cf_issue_type` on janus.freshdesk.com */
export const FRESHDESK_ISSUE_TYPE = {
  scoreTooLow: "Score too low",
  scoreTooHigh: "Score too high",
  wrongEvidence: "Wrong evidence cited",
  missingContext: "Missing Context",
  others: "Others",
} as const;

export type FreshdeskTicketKind = "dispute_score" | "feedback";

export const DISPUTE_SCORE_SUBJECT = "Dispute of Call Quality Score";

const DEFAULT_DOMAIN = "janus.freshdesk.com";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB (Freshdesk hard cap is 20MB)

export interface FreshdeskAttachment {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer | Uint8Array;
}

export type FreshdeskCustomFields = Record<string, string | number | boolean | null>;

export interface CreateFreshdeskTicketInput {
  email: string;
  name?: string;
  subject: string;
  description: string;
  type: string;
  priority?: number;
  status?: number;
  /** Freshdesk source: 2 = Portal */
  source?: number;
  tags?: string[];
  /** Janus custom fields (cf_issue_type, cf_call_id, …) */
  customFields?: FreshdeskCustomFields | null;
  attachment?: FreshdeskAttachment | null;
}

export interface FreshdeskTicketResult {
  id: number;
  subject: string;
  type: string | null;
  requesterId: number | null;
  status: number | null;
  priority: number | null;
  customFields?: Record<string, unknown> | null;
}

export function freshdeskConfigured(env: FreshdeskEnv): boolean {
  return !!String(env.FRESHDESK_API_KEY || "").trim();
}

export function resolveFreshdeskDomain(env: FreshdeskEnv): string {
  let raw = String(env.FRESHDESK_DOMAIN || DEFAULT_DOMAIN).trim();
  raw = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!raw.includes(".")) raw = `${raw}.freshdesk.com`;
  return raw;
}

function basicAuthHeader(apiKey: string): string {
  const token = btoa(`${apiKey}:X`);
  return `Basic ${token}`;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build HTML description: user text first, then optional metadata block for agents. */
export function buildTicketDescriptionHtml(
  userText: string,
  metaLines: Array<string | null | undefined> = [],
): string {
  const body = escapeHtml(userText).replace(/\n/g, "<br>");
  const meta = metaLines.map((l) => String(l || "").trim()).filter(Boolean);
  if (!meta.length) return `<div>${body}</div>`;
  const metaHtml = meta.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `<div>${body}</div><hr><p><strong>Context</strong></p><ul>${metaHtml}</ul>`;
}

export function ticketTypeForKind(kind: FreshdeskTicketKind): string {
  return kind === "dispute_score"
    ? FRESHDESK_TICKET_TYPE.disputeScore
    : FRESHDESK_TICKET_TYPE.feedback;
}

export function defaultSubjectForKind(kind: FreshdeskTicketKind, category?: string): string {
  if (kind === "dispute_score") return DISPUTE_SCORE_SUBJECT;
  const cat = String(category || "").trim();
  return cat ? `Feedback: ${cat}` : "Product feedback";
}

/**
 * Map dispute form category (value or label) → Janus `cf_issue_type` choice.
 * Accepts slug values from the UI and display labels from the ticket payload.
 */
export function mapDisputeIssueType(raw: string): string | null {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key) return null;
  if (key === "score_too_low" || key === "scoretoolow") return FRESHDESK_ISSUE_TYPE.scoreTooLow;
  if (key === "score_too_high" || key === "scoretoohigh") return FRESHDESK_ISSUE_TYPE.scoreTooHigh;
  if (key === "wrong_evidence" || key === "wrong_evidence_cited" || key === "wrongevidencecited") {
    return FRESHDESK_ISSUE_TYPE.wrongEvidence;
  }
  if (key === "missing_context" || key === "missingcontext") return FRESHDESK_ISSUE_TYPE.missingContext;
  if (key === "other" || key === "others") return FRESHDESK_ISSUE_TYPE.others;
  // Already an exact Freshdesk label
  const labels = Object.values(FRESHDESK_ISSUE_TYPE);
  const exact = labels.find((l) => l.toLowerCase() === String(raw || "").trim().toLowerCase());
  return exact || null;
}

/** Build Janus custom_fields for a ticket kind from form fields. */
export function buildTicketCustomFields(
  kind: FreshdeskTicketKind,
  fields: {
    category?: string;
    callId?: string;
    page?: string;
    dealId?: string;
    accountId?: string;
  },
): FreshdeskCustomFields {
  const out: FreshdeskCustomFields = {};
  const callId = String(fields.callId || "").trim();
  const page = String(fields.page || "").trim();
  const dealId = String(fields.dealId || "").trim();
  const accountId = String(fields.accountId || "").trim();

  if (callId) out.cf_call_id = callId.slice(0, 255);
  if (page) out.cf_page_context_hash = page.slice(0, 2000);
  if (dealId) out.cf_deal_id = dealId.slice(0, 255);
  if (accountId) out.cf_account_id = accountId.slice(0, 255);

  if (kind === "dispute_score") {
    const issueType = mapDisputeIssueType(fields.category || "");
    if (issueType) out.cf_issue_type = issueType;
    out.cf_area_of_the_product = "Coaching / scorecards";
  }

  return out;
}

function sanitizeCustomFields(
  fields: FreshdeskCustomFields | null | undefined,
): FreshdeskCustomFields {
  const out: FreshdeskCustomFields = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    const name = String(key || "").trim();
    if (!name || value == null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[name] = trimmed;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Create a Freshdesk ticket. Uses multipart when an attachment is present;
 * otherwise JSON (simpler + faster).
 */
export async function createFreshdeskTicket(
  env: FreshdeskEnv,
  input: CreateFreshdeskTicketInput,
): Promise<FreshdeskTicketResult> {
  const apiKey = String(env.FRESHDESK_API_KEY || "").trim();
  if (!apiKey) throw Object.assign(new Error("Freshdesk is not configured."), { status: 503 });

  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Requester email is required."), { status: 400 });
  }

  const subject = String(input.subject || "").trim();
  const description = String(input.description || "").trim();
  if (!subject) throw Object.assign(new Error("subject is required."), { status: 400 });
  if (!description) throw Object.assign(new Error("description is required."), { status: 400 });

  const domain = resolveFreshdeskDomain(env);
  const url = `https://${domain}/api/v2/tickets`;
  const status = input.status ?? 2; // Open
  const priority = input.priority ?? 2; // Medium
  const source = input.source ?? 2; // Portal
  const type = String(input.type || "").trim() || undefined;
  const tags = (input.tags || []).map((t) => String(t).trim()).filter(Boolean);
  const customFields = sanitizeCustomFields(input.customFields);
  const hasCustomFields = Object.keys(customFields).length > 0;

  const attachment = input.attachment;
  if (attachment) {
    const size =
      attachment.bytes instanceof ArrayBuffer
        ? attachment.bytes.byteLength
        : attachment.bytes.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(
        new Error(`Attachment too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB).`),
        { status: 400 },
      );
    }
  }

  const auth = basicAuthHeader(apiKey);
  let res: Response;

  try {
    if (attachment) {
      const form = new FormData();
      form.append("email", email);
      if (input.name) form.append("name", String(input.name).trim());
      form.append("subject", subject);
      form.append("description", description);
      form.append("status", String(status));
      form.append("priority", String(priority));
      form.append("source", String(source));
      if (type) form.append("type", type);
      for (const tag of tags) form.append("tags[]", tag);
      for (const [key, value] of Object.entries(customFields)) {
        form.append(`custom_fields[${key}]`, String(value));
      }
      const bytes =
        attachment.bytes instanceof ArrayBuffer
          ? new Uint8Array(attachment.bytes)
          : attachment.bytes;
      const blob = new Blob([bytes], {
        type: attachment.contentType || "application/octet-stream",
      });
      form.append("attachments[]", blob, attachment.filename || "screenshot.png");

      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth },
        body: form,
      });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          ...(input.name ? { name: String(input.name).trim() } : {}),
          subject,
          description,
          status,
          priority,
          source,
          ...(type ? { type } : {}),
          ...(tags.length ? { tags } : {}),
          ...(hasCustomFields ? { custom_fields: customFields } : {}),
        }),
      });
    }
  } catch (err) {
    const cause =
      err && typeof err === "object" && "cause" in err
        ? String((err as { cause?: { message?: string; code?: string } }).cause?.message ||
            (err as { cause?: { code?: string } }).cause?.code ||
            "")
        : "";
    const msg = (err as Error)?.message || "fetch failed";
    throw Object.assign(
      new Error(
        `Could not reach Freshdesk (${resolveFreshdeskDomain(env)}): ${msg}${cause ? ` — ${cause}` : ""}`,
      ),
      { status: 502 },
    );
  }

  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const errors = data.errors;
    const detail =
      (typeof data.description === "string" && data.description) ||
      (Array.isArray(errors) ? JSON.stringify(errors) : "") ||
      raw.slice(0, 300) ||
      res.statusText;
    console.warn(`[freshdesk] create ticket failed ${res.status}: ${detail}`);
    throw Object.assign(new Error(`Freshdesk error (${res.status}): ${detail}`), {
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
    });
  }

  const id = Number(data.id);
  if (!Number.isFinite(id)) {
    throw Object.assign(new Error("Freshdesk returned no ticket id."), { status: 502 });
  }

  const returnedCustom =
    data.custom_fields && typeof data.custom_fields === "object"
      ? (data.custom_fields as Record<string, unknown>)
      : null;

  console.info(
    `[freshdesk] ticket #${id} type=${type || "—"} issue=${customFields.cf_issue_type || "—"} requester=${email}`,
  );
  return {
    id,
    subject: String(data.subject || subject),
    type: data.type != null ? String(data.type) : type || null,
    requesterId: data.requester_id != null ? Number(data.requester_id) : null,
    status: data.status != null ? Number(data.status) : status,
    priority: data.priority != null ? Number(data.priority) : priority,
    customFields: returnedCustom,
  };
}

export { MAX_ATTACHMENT_BYTES };
