/** Freshdesk Support API — create tickets for score disputes + product feedback.
 *
 * Env (server-side only — never expose to the browser):
 *   FRESHDESK_API_KEY   — API key (Basic auth username; password is "X")
 *   FRESHDESK_DOMAIN    — e.g. "janus-assist.freshdesk.com" or "janus-assist"
 *
 * Docs: https://developer.freshdesk.com/api/#create_ticket
 */

export interface FreshdeskEnv {
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
}

/** Ticket Type choices configured on janus-assist.freshdesk.com */
export const FRESHDESK_TICKET_TYPE = {
  disputeScore: "Dispute of Score",
  feedback: "Feedback",
} as const;

export type FreshdeskTicketKind = "dispute_score" | "feedback";

export const DISPUTE_SCORE_SUBJECT = "Dispute of Call Quality Score";

const DEFAULT_DOMAIN = "janus-assist.freshdesk.com";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB (Freshdesk hard cap is 20MB)

export interface FreshdeskAttachment {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer | Uint8Array;
}

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
  attachment?: FreshdeskAttachment | null;
}

export interface FreshdeskTicketResult {
  id: number;
  subject: string;
  type: string | null;
  requesterId: number | null;
  status: number | null;
  priority: number | null;
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

  console.info(`[freshdesk] ticket #${id} type=${type || "—"} requester=${email}`);
  return {
    id,
    subject: String(data.subject || subject),
    type: data.type != null ? String(data.type) : type || null,
    requesterId: data.requester_id != null ? Number(data.requester_id) : null,
    status: data.status != null ? Number(data.status) : status,
    priority: data.priority != null ? Number(data.priority) : priority,
  };
}

export { MAX_ATTACHMENT_BYTES };
