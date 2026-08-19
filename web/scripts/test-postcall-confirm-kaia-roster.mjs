/**
 * v2.3 (Agent 2) — regression for the emailsFromKaiaParticipants bug: Kaia hands over a clean
 * roster of real names, but KaiaParticipantMeta carries no email field, so the old
 * email-only merge path discarded 100% of it. buildConfirmAttendees must now surface Kaia
 * participants as page-2 attendee candidates even when the transcript has no real speakers
 * (a Kaia-summary-only call) and no participant emails were supplied at all.
 */
globalThis.document = { getElementById: () => null };

import { buildConfirmAttendees } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const resolveKaiaOnly = {
  // Summary-only call: no real transcript, so no transcript speakers and no emails at all —
  // this is exactly the case the old bug produced zero attendee candidates for.
  transcriptMeta: { speakers: [] },
  participantEmails: [],
  customerIdentities: ["Ravi Kumar", "Sunil Prasad"],
  // Mirrors what resolve.ts now computes server-side (kaiaHostName -> seIdentity, and
  // identityOptions includes the Kaia names via speakersForIdentity).
  seIdentity: "Priyal Shah",
  identityOptions: ["Priyal Shah", "Ravi Kumar", "Sunil Prasad"],
  sources: {
    kaia: {
      summary: "Team walked through the demo and discussed pricing.",
      participants: [
        { displayName: "Priyal Shah", isHost: true },
        { displayName: "Ravi Kumar" },
        { displayName: "Sunil Prasad" },
      ],
    },
  },
};

const attendees = buildConfirmAttendees(resolveKaiaOnly);

assert(attendees.length >= 3, "Kaia roster with no emails still produces page-2 attendees");
for (const name of ["Priyal Shah", "Ravi Kumar", "Sunil Prasad"]) {
  const att = attendees.find((a) => a.name === name);
  assert(att, `${name} present as an attendee row`);
  assert(att.sources?.includes("kaia"), `${name} tagged with source "kaia"`);
}

// In this test environment there's no logged-in currentSession, so the code also seeds a
// placeholder "se@freshworks.com" Primary SE candidate — a distinct person from the real
// Kaia host, competing for the single "Primary SE" slot. The concrete assertion for the
// isHost hint is that the host is classified as SE at all (never silently bucketed as
// Customer, which is what the pre-fix behavior did for every bare Kaia name).
const host = attendees.find((a) => a.name === "Priyal Shah");
assert(
  host.role === "Primary SE" || host.role === "Secondary SE",
  `Kaia host (isHost) maps to an SE role, got "${host.role}"`,
);

console.log("test-postcall-confirm-kaia-roster: ok");
