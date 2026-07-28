/**
 * Unit tests for Pass 7 summarise normalize helpers (no LLM).
 */
import {
  normalizeFollowUps,
  normalizeObjections,
  normalizeCallNotes,
  normalizeMomDraft,
} from "../src/postcall/summarise.ts";

const checks: [string, boolean][] = [];

const followUps = normalizeFollowUps([
  {
    description: "Send POC plan with exit criteria",
    owner: "se",
    dueDate: "Friday",
    status: "open",
    sourceQuote: "Can you send a plan by Friday?",
  },
  {
    description: "Internal security review",
    owner: "Customer",
    dueDate: null,
    status: "OPEN",
    sourceQuote: null,
  },
  { description: "", owner: "se", dueDate: null, status: "open", sourceQuote: null },
  {
    description: "Book exec sponsor",
    owner: "account executive",
    dueDate: "next week",
    status: "weird",
    sourceQuote: "We need an exec on the next call",
  },
]);

checks.push(
  ["followUps length 3", followUps.length === 3],
  ["customer owner normalized", followUps[1].owner === "customer"],
  ["ae owner from phrase", followUps[2].owner === "ae"],
  ["unknown status → open", followUps[2].status === "open"],
  ["empty description dropped", !followUps.some((f) => !f.description)],
);

const objections = normalizeObjections([
  {
    objectionText: "Price looks high vs Zendesk",
    handling: "Walked through agent-based value",
    landed: false,
    theme: "pricing",
  },
  { objectionText: "", handling: null, landed: true, theme: null },
  {
    objectionText: "SSO not in trial",
    handling: null,
    landed: true,
    theme: "security",
  },
]);

checks.push(
  ["objections length 2", objections.length === 2],
  ["landed false preserved", objections[0].landed === false],
  ["landed true preserved", objections[1].landed === true],
  ["empty objection dropped", !objections.some((o) => !o.objectionText)],
);

const notes = normalizeCallNotes({
  callNotes:
    "The call ended without a customer-owned next step, which is what turned a good demo into silence.",
});
checks.push(
  ["callNotes extracted", notes.includes("customer-owned next step")],
  ["callNotes not empty", notes.length > 20],
);

const mom = normalizeMomDraft({
  draftBody: "Thanks for the discussion. Decisions: proceed to POC. Actions: SE to send plan by Friday.",
});
checks.push(
  ["mom draftBody set", mom.draftBody.includes("proceed to POC")],
  ["mom never auto-sent", mom.sentAt === null],
  ["mom sentBy null", mom.sentBy === null],
  ["mom editedBody null", mom.editedBody === null],
  ["flat draft becomes outcome", (mom.outcome || "").includes("proceed to POC")],
);

const structured = normalizeMomDraft(
  {
    outcome: "Evaluated Freshdesk as a Salesforce replacement and agreed a trial.",
    keyPoints: [
      { title: "Omnichannel support", detail: "Unified inbox across email and WhatsApp." },
      { title: "", detail: "dropped" },
    ],
    actionItems: [
      {
        text: "Follow up via email on open questions",
        owner: "se",
        dueDate: null,
        atS: null,
        sourceQuote: "I will follow up via email",
      },
    ],
    draftBody: "",
  },
  `WEBVTT\n\n00:06:12.000 --> 00:06:18.000\nSE: I will follow up via email to address any questions.\n`,
);
checks.push(
  ["structured outcome", structured.outcome.includes("Salesforce")],
  ["keyPoints length 1", structured.keyPoints?.length === 1],
  ["action item stamped atS", structured.actionItems?.[0]?.atS === 372],
  ["assembled draftBody has Key points", structured.draftBody.includes("Key points")],
  ["assembled draftBody has Action items", structured.draftBody.includes("Action items")],
);

// Call notes and MoM must remain independent — normalize does not copy one into the other.
checks.push(
  ["notes ≠ mom body", notes !== mom.draftBody],
  ["mom does not contain blunt coaching phrase", !mom.draftBody.includes("turned a good demo")],
);

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${checks.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} checks passed`);
