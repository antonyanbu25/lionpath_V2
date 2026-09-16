import {
  identitiesShouldMerge,
  mergeCallIdentities,
  identityMatchesName,
  speakerMatchesEmailLocal,
  normalizePersonKey,
  firstNamesSimilar,
  emailLocalMatchesName,
} from "../identity-merge.js";
import { buildConfirmAttendees } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(identityMatchesName("Emma Wark", "emma w"), "first-name fuzzy match");
assert(identityMatchesName("emma.w@gamersheek.co.uk", "Emma Wark"), "email local matches full name");
assert(speakerMatchesEmailLocal("emma w", "emma.w@gamersheek.co.uk"), "speaker matches email local");

assert(firstNamesSimilar("Andirius", "andrius"), "Kaia typo Andirius ~ Andrius");
assert(firstNamesSimilar("Andrius", "andrius"), "exact first name");
assert(!firstNamesSimilar("An", "Andrius"), "do not merge on starts-with-A");
assert(!firstNamesSimilar("Alex", "Andrius"), "Alex is not Andrius");
assert(!firstNamesSimilar("Shamron", "Andrius"), "Shamron is not Andrius");
assert(identityMatchesName("andrius salasevicius", "Andirius"), "email-derived name matches Kaia Andirius");
assert(identityMatchesName("Andirius", "andrius.salasevicius@invertus.eu"), "Kaia Andirius matches typed email");
assert(speakerMatchesEmailLocal("Andirius", "andrius.salasevicius@invertus.eu"), "Kaia speaker matches email local");
assert(
  !identityMatchesName("andrius salasevicius", "Andirius Jones"),
  "do not merge when both sides have different last names",
);

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

const ANDRIUS_EMAIL = "andrius.salasevicius@invertus.eu";
const andriusMerged = mergeCallIdentities(
  [
    {
      name: "andrius salasevicius",
      email: ANDRIUS_EMAIL,
      label: ANDRIUS_EMAIL,
      role: "Primary SE",
    },
    { name: "Andirius", email: null, label: "Andirius", role: "Customer" },
  ],
  [],
  ["Andirius"],
);
assert(andriusMerged.length === 1, `Andrius email + Kaia Andirius merge to one, got ${andriusMerged.length}`);
assert(andriusMerged[0].email === ANDRIUS_EMAIL, "merged row keeps typed email");
assert(
  /andrius/i.test(andriusMerged[0].name) && !/^andirius$/i.test(andriusMerged[0].name.trim()),
  `prefer email-derived name over Kaia typo, got ${andriusMerged[0].name}`,
);
assert(andriusMerged[0].role === "Primary SE", "prefer typed-email role when sources disagree");
assert(
  (andriusMerged[0].aliasKeys || []).includes("andirius"),
  "merged row keeps Kaia alias so source chips still match",
);

const andriusRoster = mergeCallIdentities(
  [
    {
      name: "andrius salasevicius",
      email: ANDRIUS_EMAIL,
      label: ANDRIUS_EMAIL,
      role: "Customer",
    },
    { name: "Andirius", email: null, label: "Andirius", role: "Customer" },
    { name: "Shamron", email: null, label: "Shamron", role: "Secondary SE" },
    { name: "Alex SE", email: "se@freshworks.com", label: "Alex SE", role: "Secondary SE" },
  ],
  [],
  ["Andirius", "Shamron", "Alex SE"],
);
assert(andriusRoster.length === 3, `Andrius/Andirius collapse; Shamron and Alex stay, got ${andriusRoster.length}`);
assert(
  andriusRoster.filter((a) => (a.email || "") === ANDRIUS_EMAIL || /andir?ius/i.test(a.name)).length === 1,
  "only one Andrius row",
);
assert(
  andriusRoster.some((a) => /shamron/i.test(a.name)),
  "Shamron is not merged into Andrius",
);
assert(
  andriusRoster.some((a) => (a.email || "") === "se@freshworks.com" || /alex/i.test(a.name)),
  "Alex SE is not merged into Andrius",
);

assert(
  !identitiesShouldMerge(
    { name: "andrius salasevicius", email: ANDRIUS_EMAIL, label: ANDRIUS_EMAIL },
    { name: "Shamron", label: "Shamron" },
  ),
  "Shamron vs Andrius must not merge",
);
assert(
  !identitiesShouldMerge(
    { name: "andrius salasevicius", email: ANDRIUS_EMAIL, label: ANDRIUS_EMAIL },
    { name: "Alex SE", email: "se@freshworks.com", label: "Alex SE" },
  ),
  "Alex SE vs Andrius must not merge",
);
assert(
  !identityMatchesName("andrius salasevicius", "se@freshworks.com"),
  "last-name letters 'se' must not match se@ email",
);
assert(
  !identitiesShouldMerge(
    { name: "andrius salasevicius", email: ANDRIUS_EMAIL, label: ANDRIUS_EMAIL },
    { name: "Alex SE", label: "Alex SE" },
  ),
  "Alex SE without email still must not merge with Andrius",
);

const typedCustomerWins = mergeCallIdentities(
  [
    { name: "andrius salasevicius", email: ANDRIUS_EMAIL, label: ANDRIUS_EMAIL, role: "Customer" },
    { name: "Andirius", email: null, label: "Andirius", role: "Primary SE" },
  ],
  [],
  ["Andirius"],
);
assert(typedCustomerWins.length === 1, "role-conflict pair still merges");
assert(typedCustomerWins[0].role === "Customer", "typed email Customer beats Kaia Primary SE guess");

const MATT_EMAIL = "matthewn@learnprogroup.com";
assert(emailLocalMatchesName(MATT_EMAIL, "Matt Newman"), "matthewn = matthew+n of Matt Newman");
assert(emailLocalMatchesName(MATT_EMAIL, "Matthew Newman"), "matthewn = matthew+n of Matthew Newman");
assert(emailLocalMatchesName("mattnewman@learnprogroup.com", "Matt Newman"), "matt+newman concatenation");
assert(emailLocalMatchesName("mnewman@learnprogroup.com", "Matt Newman"), "m+newman concatenation");
assert(!emailLocalMatchesName("se@freshworks.com", "andrius salasevicius"), "se@ local is too short to concatenate");
assert(!firstNamesSimilar("matt", "matthewn"), "4-letter matt still fails firstNamesSimilar vs matthewn");
assert(identityMatchesName("Matt Newman", "Matthewn"), "Kaia Matt Newman matches email-derived Matthewn");
assert(identityMatchesName("Matt Newman", MATT_EMAIL), "Kaia Matt Newman matches typed email");
assert(speakerMatchesEmailLocal("Matt Newman", MATT_EMAIL), "Matt Newman matches matthewn@ local");

const mattMerged = mergeCallIdentities(
  [
    { name: "Matt Newman", email: null, label: "Matt Newman", role: "Customer" },
    { name: "Matthewn", email: MATT_EMAIL, label: MATT_EMAIL, role: "Customer" },
  ],
  [],
  ["Matt Newman"],
);
assert(mattMerged.length === 1, `Matt Newman + Matthewn email merge to one, got ${mattMerged.length}`);
assert(mattMerged[0].email === MATT_EMAIL, "merged Matt keeps typed email");
assert(mattMerged[0].name === "Matt Newman", `prefer Kaia full name over Matthewn, got ${mattMerged[0].name}`);
assert((mattMerged[0].aliasKeys || []).includes("matthewn"), "merged Matt keeps email-local alias");
assert((mattMerged[0].aliasKeys || []).includes("matt newman"), "merged Matt keeps Kaia alias");

const mattRoster = mergeCallIdentities(
  [
    { name: "Alex SE", email: "se@freshworks.com", label: "Alex SE", role: "Secondary SE" },
    { name: "Nivi", email: null, label: "Nivi", role: "Primary SE" },
    { name: "Aishwarya Krishna", email: null, label: "Aishwarya Krishna", role: "AE" },
    { name: "Matt Newman", email: null, label: "Matt Newman", role: "Customer" },
    { name: "Matthewn", email: MATT_EMAIL, label: MATT_EMAIL, role: "Customer" },
  ],
  [],
  ["Alex SE", "Nivi", "Aishwarya Krishna", "Matt Newman"],
);
assert(mattRoster.length === 4, `Matt/Matthewn collapse; Nivi/Aishwarya/Alex stay, got ${mattRoster.length}`);
assert(
  mattRoster.filter((a) => (a.email || "") === MATT_EMAIL || /matt/i.test(a.name)).length === 1,
  "only one Matt row",
);
assert(mattRoster.some((a) => /nivi/i.test(a.name)), "Nivi is not merged into Matt");
assert(mattRoster.some((a) => /aishwarya/i.test(a.name)), "Aishwarya is not merged into Matt");
assert(
  mattRoster.some((a) => (a.email || "") === "se@freshworks.com" || /alex/i.test(a.name)),
  "Alex SE is not merged into Matt",
);
assert(
  !identitiesShouldMerge(
    { name: "Matt Newman", label: "Matt Newman" },
    { name: "Nivi", label: "Nivi" },
  ),
  "Nivi vs Matt must not merge",
);
assert(
  !identitiesShouldMerge(
    { name: "Matthewn", email: MATT_EMAIL, label: MATT_EMAIL },
    { name: "Aishwarya Krishna", label: "Aishwarya Krishna" },
  ),
  "Aishwarya vs Matthewn must not merge",
);
assert(
  !identitiesShouldMerge(
    { name: "Matthewn", email: MATT_EMAIL, label: MATT_EMAIL },
    { name: "Alex SE", email: "se@freshworks.com", label: "Alex SE" },
  ),
  "Alex SE vs Matthewn must not merge",
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

const andriusConfirm = buildConfirmAttendees({
  transcriptMeta: { speakers: ["Andirius", "Shamron", "Alex SE"] },
  participantEmails: [ANDRIUS_EMAIL, "se@freshworks.com"],
  customerIdentities: ["Andirius", ANDRIUS_EMAIL],
  seIdentity: "Alex SE",
  identityOptions: ["Andirius", "Shamron"],
  sources: {
    kaia: {
      participants: [{ displayName: "Andirius" }, { displayName: "Shamron" }, { displayName: "Alex SE" }],
    },
  },
});
const andriusRows = andriusConfirm.filter(
  (a) => (a.email || "") === ANDRIUS_EMAIL || /andir?ius/i.test(a.name),
);
assert(andriusRows.length === 1, `confirm Who-was-on-the-call has one Andrius, got ${andriusRows.length}`);
assert(andriusRows[0].email === ANDRIUS_EMAIL, "confirm Andrius keeps typed email");
assert(andriusRows[0].sources?.includes("typed"), "merged Andrius shows Typed email chip");
assert(andriusRows[0].sources?.includes("kaia"), "merged Andrius keeps Kaia chip");
assert(andriusConfirm.some((a) => /shamron/i.test(a.name)), "confirm still lists Shamron");
assert(
  andriusConfirm.filter((a) => /andirius/i.test(a.name) && !(a.email || "").includes("andrius")).length === 0,
  "confirm does not keep a standalone Andirius Kaia row",
);

const mattConfirm = buildConfirmAttendees({
  transcriptMeta: { speakers: ["Alex SE", "Nivi", "Aishwarya Krishna", "Matt Newman"] },
  participantEmails: [MATT_EMAIL, "se@freshworks.com"],
  customerIdentities: ["Matt Newman", MATT_EMAIL],
  seIdentity: "Nivi",
  aeIdentity: "Aishwarya Krishna",
  identityOptions: ["Alex SE", "Nivi", "Aishwarya Krishna", "Matt Newman", MATT_EMAIL],
  sources: {
    kaia: {
      participants: [
        { displayName: "Alex SE" },
        { displayName: "Nivi" },
        { displayName: "Aishwarya Krishna" },
        { displayName: "Matt Newman" },
      ],
    },
  },
});
const mattRows = mattConfirm.filter(
  (a) => (a.email || "") === MATT_EMAIL || /matt/i.test(a.name),
);
assert(mattRows.length === 1, `confirm Who-was-on-the-call has one Matt, got ${mattRows.length}`);
assert(mattRows[0].email === MATT_EMAIL, "confirm Matt keeps typed email");
assert(mattRows[0].name === "Matt Newman", `confirm shows Matt Newman, got ${mattRows[0].name}`);
assert(mattRows[0].sources?.includes("typed"), "merged Matt shows Typed email chip");
assert(mattRows[0].sources?.includes("kaia"), "merged Matt keeps Kaia chip");
assert(mattConfirm.some((a) => /nivi/i.test(a.name)), "confirm still lists Nivi");
assert(mattConfirm.some((a) => /aishwarya/i.test(a.name)), "confirm still lists Aishwarya");
assert(mattConfirm.some((a) => /alex/i.test(a.name)), "confirm still lists Alex SE");
assert(
  mattConfirm.filter((a) => /^matthewn$/i.test(String(a.name || "").trim()) && !(a.email || "").includes("matthewn"))
    .length === 0,
  "confirm does not keep a standalone Matthewn Kaia-less row",
);

const roleMerged = mergeCallIdentities(
  [
    { name: "Daniel Foo", email: null, label: "Daniel Foo", role: "Customer" },
    { name: "daniel", email: "daniel@getgo.com", label: "daniel@getgo.com", role: "Partner" },
  ],
  [],
  ["Daniel Foo"],
);
assert(roleMerged.length === 1, "role conflict merges to one row");
assert(roleMerged[0].role === "Partner", "prefer typed-email role on conflict");

console.log("test-identity-merge.mjs: all passed");
