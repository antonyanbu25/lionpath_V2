/** Soft-fail manager dispute email (Resend). Off unless env flag + API key set.
 *
 * Node/VPS: DISPUTE_NOTIFY_ENABLED / EMAIL_PROVIDER_API_KEY / DISPUTE_NOTIFY_FROM
 * are mapped in worker/src/node-server.ts buildEnv() from process.env.
 */

export interface DisputeNotifyEnv {
  DISPUTE_NOTIFY_ENABLED?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  DISPUTE_NOTIFY_FROM?: string;
}

export interface ManagerDisputeEmailPayload {
  to: string;
  toName?: string;
  seName?: string;
  callTitle?: string;
  category?: string;
  note?: string;
  link?: string;
}

function truthyFlag(raw: string | undefined): boolean {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** True when notify is enabled and a provider API key is present. */
export function emailNotifyAvailable(env: DisputeNotifyEnv): boolean {
  return truthyFlag(env.DISPUTE_NOTIFY_ENABLED) && !!String(env.EMAIL_PROVIDER_API_KEY || "").trim();
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send manager dispute email via Resend HTTPS API.
 * Soft-fails: when unavailable, logs and returns { sent: false } — never throws for config gaps.
 */
export async function sendManagerDisputeEmail(
  env: DisputeNotifyEnv,
  payload: ManagerDisputeEmailPayload,
): Promise<{ sent: boolean; via: string | null; error?: string }> {
  if (!emailNotifyAvailable(env)) {
    console.info("[dispute-notify] skipped — DISPUTE_NOTIFY_ENABLED off or EMAIL_PROVIDER_API_KEY missing");
    return { sent: false, via: null };
  }

  const to = String(payload.to || "")
    .trim()
    .toLowerCase();
  if (!to || !to.includes("@")) {
    console.warn("[dispute-notify] invalid recipient email");
    return { sent: false, via: null, error: "invalid_to" };
  }

  const from = String(env.DISPUTE_NOTIFY_FROM || "").trim() || "LionPath <onboarding@resend.dev>";
  const seName = String(payload.seName || "An SE").trim() || "An SE";
  const callTitle = String(payload.callTitle || "a call").trim() || "a call";
  const category = String(payload.category || "score dispute").trim();
  const note = String(payload.note || "").trim();
  const link = String(payload.link || "").trim();
  const toName = String(payload.toName || "").trim();

  const subject = `Score dispute from ${seName}: ${callTitle}`;
  const textLines = [
    `Hi${toName ? ` ${toName}` : ""},`,
    "",
    `${seName} submitted a score dispute for "${callTitle}".`,
    `Category: ${category}`,
    note ? `Note: ${note}` : "",
    link ? `Review: ${link}` : "",
    "",
    "— LionPath",
  ].filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""));

  const html = `
    <p>Hi${toName ? ` ${escapeHtml(toName)}` : ""},</p>
    <p><strong>${escapeHtml(seName)}</strong> submitted a score dispute for <strong>${escapeHtml(callTitle)}</strong>.</p>
    <p>Category: ${escapeHtml(category)}</p>
    ${note ? `<p>Note: ${escapeHtml(note)}</p>` : ""}
    ${link ? `<p><a href="${escapeHtml(link)}">Review in LionPath</a></p>` : ""}
    <p>— LionPath</p>
  `.trim();

  const apiKey = String(env.EMAIL_PROVIDER_API_KEY || "").trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: textLines.join("\n"),
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[dispute-notify] Resend ${res.status}: ${body.slice(0, 200)}`);
      return { sent: false, via: "resend", error: `provider_${res.status}` };
    }

    console.info(`[dispute-notify] sent via resend to ${to}`);
    return { sent: true, via: "resend" };
  } catch (err) {
    console.warn("[dispute-notify] send failed:", (err as Error)?.message || err);
    return { sent: false, via: "resend", error: "send_failed" };
  }
}
