import {
  identitiesShouldMerge,
  mergeCallIdentities,
  identityMatchesName,
  speakerMatchesEmailLocal,
  normalizePersonKey,
} from "../identity-merge.js";
import { buildConfirmAttendees } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(identityMatchesName("Emma Wark", "emma w"), "first-name fuzzy match");
assert(identityMatchesName("emma.w@gamersheek.co.uk", "Emma Wark"), "email local matches full name");
assert(speakerMatchesEmailLocal("emma w", "emma.w@gamersheek.co.uk"), "speaker matches email local");

const emmaMerged = mergeCallIdentities(
  [
    { name: "Emma Wark", email: null, label: "Emma Wark", role: "Customer" },
    { name: "emma w", email: "emma.w@gamersheek.co.uk", label: "emma w", role: "Customer" },
  ],
  [{ name: "Emma Wark", email: "emma.w@gamersheek.co.uk" }],
  ["emma w", "Emma Wark"],
);
assert(emmaMerged.length === 1, `Emma rows merge to one, got ${emmaMerged.length}`);
assert(emmaMerged[0].name === "Emma Wark", "prefer CRM/full name");
assert(emmaMerged[0].email === "emma.w@gamersheek.co.uk", "keep email on merged row");

const seanMerged = mergeCallIdentities(
  [
    { name: "sean", email: null, label: "sean", role: "Customer" },
    { name: "sean", email: "sean@gamersheek.co.uk", label: "sean@gamersheek.co.uk", role: "Customer" },
  ],
  [],
  ["sean"],
);
assert(seanMerged.length === 1, "sean name + email collapse");
assert(seanMerged[0].email === "sean@gamersheek.co.uk", "sean keeps email");

const seNotMerged = mergeCallIdentities(
  [
    { name: "se", email: null, label: "se", role: "Secondary SE" },
    { name: "se", email: "se@freshworks.com", label: "se@freshworks.com", role: "Primary SE" },
  ],
  [],
  ["se"],
);
assert(seNotMerged.length === 2, "do not merge ambiguous short se initial with internal email");

assert(
  !identitiesShouldMerge(
    { name: "se", label: "se" },
    { name: "se", email: "se@freshworks.com", label: "se@freshworks.com" },
  ),
  "short-token guard blocks se merge",
);

globalThis.document = { getElementById: () => null };

const resolve = {
  transcriptMeta: { speakers: ["Emma Wark", "emma w", "Antony S."] },
  participantEmails: ["emma.w@gamersheek.co.uk", "me@freshworks.com"],
  customerIdentities: ["Emma Wark", "emma.w@gamersheek.co.uk"],
  seIdentity: "Antony S.",
  identityOptions: ["emma w"],
};

const attendees = buildConfirmAttendees(resolve);
const emmaRows = attendees.filter(
  (a) =>
    normalizePersonKey(a.name).includes("emma") ||
    (a.email || "").includes("emma.w@gamersheek.co.uk"),
);
assert(emmaRows.length === 1, `confirm list has one Emma row, got ${emmaRows.length}`);
assert(emmaRows[0].name === "Emma Wark", "confirm shows Emma Wark label");
assert(emmaRows[0].email === "emma.w@gamersheek.co.uk", "confirm shows Emma email");

const roleMerged = mergeCallIdentities(
  [
    { name: "Daniel Foo", email: null, label: "Daniel Foo", role: "Customer" },
    { name: "daniel", email: "daniel@getgo.com", label: "daniel@getgo.com", role: "Partner" },
  ],
  [],
  ["Daniel Foo"],
);
assert(roleMerged.length === 1, "role conflict merges to one row");
assert(roleMerged[0].role === "Partner" || roleMerged[0].role === "Customer", "role preserved from cluster");

console.log("test-identity-merge.mjs: all passed");
