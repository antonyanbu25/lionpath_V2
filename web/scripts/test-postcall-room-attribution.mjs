/**
 * Smoke tests for the confirm-page "Meeting room" role + speaker-attribution suggestions
 * (v2.2 identity-aware scoring build). No DOM — exercises the pure builder/render functions.
 */
globalThis.document = { getElementById: () => null };

import { buildConfirmAttendees, renderConfirmationGate } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const resolve = {
  transcriptMeta: { speakers: ["Priyal Shah", "Ravi Kumar", "Meeting Room"] },
  participantEmails: ["priyal@freshworks.com", "ravi@freshworks.com"],
  customerIdentities: [],
  seIdentity: "Priyal Shah",
  aeIdentity: "Ravi Kumar",
  speakerAttribution: {
    roster: [
      {
        label: "Meeting Room",
        canonicalName: "Meeting Room",
        suggestedRole: "Meeting room",
        confidence: 0.8,
        evidence: "Shared conference-room mic label, multiple voices under it.",
      },
    ],
    roomSegments: [
      {
        label: "Meeting Room",
        startS: 120,
        endS: 140,
        attributedTo: "Sunil Prasad",
        confidence: 0.7,
        quote: "We're mainly evaluating ticket routing.",
        reason: "Self-introduces as the customer stakeholder.",
      },
      {
        label: "Meeting Room",
        startS: 200,
        endS: 210,
        attributedTo: "Sunil Prasad",
        confidence: 0.6,
        quote: "What about reporting?",
        reason: "Same voice pattern as the earlier attributed span.",
      },
    ],
  },
};

const attendees = buildConfirmAttendees(resolve);
const roomAttendee = attendees.find((a) => /meeting room/i.test(a.name) || /meeting room/i.test(a.label || ""));
assert(!!roomAttendee, "a 'Meeting Room' attendee row is built from the transcript speaker + roster");
assert(roomAttendee.role === "Meeting room", "AI roster suggestion assigns the 'Meeting room' role");
assert(roomAttendee.roomGroups?.length === 1, "room segments for the same person collapse into one group");
assert(roomAttendee.roomGroups[0].spans.length === 2, "both segments for that person are kept in the group");
assert(roomAttendee.roomGroups[0].attributedTo === "Sunil Prasad", "group is attributed to the AI-suggested person");

const html = renderConfirmationGate(resolve, { primary: "discovery", confidence: 0.8 });
assert(html.includes("Meeting room"), "role select includes the new 'Meeting room' option");
assert(html.includes("postcall-room-groups"), "renders the meeting-room sub-panel");
assert(html.includes("postcall-attendee-row--room-member"), "nested rows use the room-member modifier class");
assert(html.includes("Sunil Prasad"), "attributed person name shown in the sub-panel");
assert(html.includes("postcall-room-add-person"), "sub-panel offers an 'Add person…' affordance");

// A resolve with no speakerAttribution must render exactly as before (no panel, no crash).
const plainResolve = {
  transcriptMeta: { speakers: ["Priyal Shah", "Ravi Kumar", "Farhan Sidek"] },
  participantEmails: ["priyal@freshworks.com"],
  customerIdentities: ["Farhan Sidek"],
  seIdentity: "Priyal Shah",
  aeIdentity: "Ravi Kumar",
};
const plainAttendees = buildConfirmAttendees(plainResolve);
assert(plainAttendees.every((a) => !a.roomGroups?.length), "no roomGroups without a speakerAttribution pass");
const plainHtml = renderConfirmationGate(plainResolve, { primary: "discovery", confidence: 0.7 });
assert(!plainHtml.includes("postcall-room-groups"), "no room sub-panel rendered when nothing is attributable");

console.log("test-postcall-room-attribution: ok");
