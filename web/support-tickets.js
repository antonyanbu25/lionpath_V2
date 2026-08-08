/** Client helper — POST /api/tickets (Freshdesk) for score disputes + feedback. */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45000;

/**
 * @param {File} file
 * @returns {Promise<{ name: string, contentType: string, base64: string }>}
 */
async function fileToBase64Payload(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    name: file.name || "screenshot.png",
    contentType: file.type || "application/octet-stream",
    base64: btoa(binary),
  };
}

/**
 * @param {{
 *   workerUrl: string,
 *   getToken?: () => Promise<string|null|undefined>,
 *   email: string,
 *   kind: "dispute_score" | "feedback",
 *   description: string,
 *   subject?: string,
 *   category?: string,
 *   name?: string,
 *   callId?: string,
 *   company?: string,
 *   themeKey?: string,
 *   score?: string|number|null,
 *   grade?: string|number|null,
 *   page?: string,
 *   link?: string,
 *   attachment?: File|null,
 * }} opts
 * @returns {Promise<{ ok: true, ticketId: number, subject: string, type: string|null, email: string, kind: string }>}
 */
export async function createSupportTicket(opts) {
  const workerUrl = String(opts.workerUrl || "").replace(/\/$/, "");
  if (!workerUrl) throw new Error("Worker URL is not configured.");

  const description = String(opts.description || "").trim();
  if (!description) throw new Error("Please describe the issue.");

  const email = String(opts.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Sign in required to submit a ticket.");

  const file = opts.attachment instanceof File && opts.attachment.size > 0 ? opts.attachment : null;
  if (file && file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Screenshot is too large (max 8MB).");
  }

  let token = null;
  try {
    token = typeof opts.getToken === "function" ? await opts.getToken() : null;
  } catch (err) {
    throw new Error(
      `Could not refresh sign-in token: ${err?.message || "auth error"}. Try signing out and back in.`,
    );
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    kind: opts.kind === "dispute_score" ? "dispute_score" : "feedback",
    description,
    email,
  };
  if (opts.subject) payload.subject = String(opts.subject);
  if (opts.category) payload.category = String(opts.category);
  if (opts.name) payload.name = String(opts.name);
  if (opts.callId) payload.callId = String(opts.callId);
  if (opts.company) payload.company = String(opts.company);
  if (opts.themeKey) payload.themeKey = String(opts.themeKey);
  if (opts.score != null && opts.score !== "") payload.score = String(opts.score);
  if (opts.grade != null && opts.grade !== "") payload.grade = String(opts.grade);
  if (opts.page) payload.page = String(opts.page);
  if (opts.link) payload.link = String(opts.link);

  if (file) {
    const encoded = await fileToBase64Payload(file);
    payload.attachmentFilename = encoded.name;
    payload.attachmentContentType = encoded.contentType;
    payload.attachmentBase64 = encoded.base64;
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${workerUrl}/api/tickets`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Ticket request timed out. Check the API is running on :8787 and try again.");
    }
    const msg = String(err?.message || err || "");
    if (/failed to fetch|fetch failed|networkerror|load failed/i.test(msg)) {
      throw new Error(
        `Cannot reach API at ${workerUrl}. Is the worker running? (open ${workerUrl}/api/config)`,
      );
    }
    throw new Error(msg || "Could not create ticket.");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Could not create ticket (${res.status}).`);
  }
  return data;
}
