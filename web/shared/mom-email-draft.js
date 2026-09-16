/**
 * Plain-text customer MoM email — deterministic layout for Edit draft / send.
 */

const OWNER_LABEL = { se: "SE", ae: "AE", customer: "Customer" };

function ownerLabel(owner) {
  const key = String(owner || "").toLowerCase();
  return OWNER_LABEL[key] || (owner ? String(owner) : "");
}

function formatActionLine(item) {
  const who = ownerLabel(item.owner);
  const parts = [];
  if (who) parts.push(who);
  if (item.dueDate) parts.push(`by ${item.dueDate}`);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  return `• ${item.text}${suffix}`;
}

function formatTopicLine(kp) {
  return kp.detail ? `• ${kp.title} — ${kp.detail}` : `• ${kp.title}`;
}

/**
 * @param {object} opts
 * @param {string} [opts.outcome]
 * @param {Array<{title: string, detail?: string|null}>} [opts.keyPoints]
 * @param {Array<{text: string, owner?: string|null, dueDate?: string|null}>} [opts.actionItems]
 * @param {string} [opts.greetingName] First name for "Dear {name},"
 * @param {string} [opts.companyName]
 * @param {string} [opts.meetingTitle]
 */
export function assembleMomEmailDraft(opts = {}) {
  const outcome = String(opts.outcome || "").trim();
  const keyPoints = Array.isArray(opts.keyPoints) ? opts.keyPoints.filter((k) => k?.title) : [];
  const actionItems = Array.isArray(opts.actionItems)
    ? opts.actionItems.filter((a) => a?.text)
    : [];

  if (!outcome && !keyPoints.length && !actionItems.length) return "";

  const greetingName = String(opts.greetingName || "").trim();
  const companyName = String(opts.companyName || "").trim();
  const meetingTitle = String(opts.meetingTitle || "").trim();

  const lines = [];

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

/** Pull "Dear Name" from an existing draft when attendees are missing. */
export function greetingNameFromDraft(draftBody) {
  const m = String(draftBody || "").match(/^Dear\s+([^,\n]+)/i);
  return m ? m[1].trim() : "";
}

export { ownerLabel as momEmailOwnerLabel };
