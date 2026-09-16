/**
 * Plain-text customer MoM email — deterministic layout (mirrors web/shared/mom-email-draft.js).
 */

const OWNER_LABEL: Record<string, string> = { se: "SE", ae: "AE", customer: "Customer" };

function ownerLabel(owner: unknown): string {
  const key = String(owner || "").toLowerCase();
  return OWNER_LABEL[key] || (owner ? String(owner) : "");
}

function formatActionLine(item: { text?: string; owner?: string | null; dueDate?: string | null }): string {
  const who = ownerLabel(item.owner);
  const parts: string[] = [];
  if (who) parts.push(who);
  if (item.dueDate) parts.push(`by ${item.dueDate}`);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  return `• ${item.text}${suffix}`;
}

function formatTopicLine(kp: { title?: string; detail?: string | null }): string {
  return kp.detail ? `• ${kp.title} — ${kp.detail}` : `• ${kp.title}`;
}

export function assembleMomEmailDraft(opts: {
  outcome?: string;
  keyPoints?: Array<{ title: string; detail?: string | null }>;
  actionItems?: Array<{ text: string; owner?: string | null; dueDate?: string | null }>;
  greetingName?: string;
  companyName?: string;
  meetingTitle?: string;
} = {}): string {
  const outcome = String(opts.outcome || "").trim();
  const keyPoints = Array.isArray(opts.keyPoints) ? opts.keyPoints.filter((k) => k?.title) : [];
  const actionItems = Array.isArray(opts.actionItems) ? opts.actionItems.filter((a) => a?.text) : [];

  if (!outcome && !keyPoints.length && !actionItems.length) return "";

  const greetingName = String(opts.greetingName || "").trim();
  const companyName = String(opts.companyName || "").trim();
  const meetingTitle = String(opts.meetingTitle || "").trim();

  const lines: string[] = [];

  if (greetingName) {
    lines.push(`Dear ${greetingName},`, "");
  } else if (companyName) {
    lines.push(`Dear ${companyName} team,`, "");
  } else {
    lines.push("Hello,", "");
  }

  const thanks = meetingTitle
    ? `Thank you for your time today for ${meetingTitle}.`
    : "Thank you for your time today.";
  lines.push(thanks, "");

  if (outcome) {
    lines.push("Meeting outcome", "", outcome, "");
  }

  if (keyPoints.length) {
    lines.push("What we covered", "", ...keyPoints.map(formatTopicLine), "");
  }

  if (actionItems.length) {
    lines.push("Next steps", "", ...actionItems.map(formatActionLine), "");
  }

  lines.push("Best regards,");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
