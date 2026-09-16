/**
 * Unit tests for post-call Pass 0 deal resolution (no network).
 * Run: tsx scripts/test-postcall-resolve.ts
 */

import assert from "node:assert/strict";
import {
  rankDealsOnAccount,
  resolveAccountMatch,
  suggestedCompanyName,
} from "../src/postcall/match.ts";
import { extractEmailsFromText, isFreeMailDomain } from "../src/postcall/participants.ts";
import { inferCallIdentities, runPostCallResolve } from "../src/postcall/resolve.ts";
import { VIDEO_DEPENDENT_THEME_KEYS } from "../src/rubric-profiles.ts";

const now = Date.parse("2026-07-24T12:00:00Z");
const ownerId = "user_se_1";

const accounts = [
  { id: "acc_acme", name: "Acme Corp", domain: "acme.com" },
  { id: "acc_pioneer", name: "Pioneer Metering", domain: "pioneermetering.co.za" },
];

const briefs = [
  {
    id: "prep_1",
    accountId: "acc_acme",
    dealId: "deal_fd",
    ownerId,
    createdAt: now - 5 * 24 * 60 * 60 * 1000,
    companyName: "Acme Corp",
    domain: "acme.com",
    prospectEmails: ["sunil@acme.com", "eva@acme.com"],
  },
  {
    id: "prep_2",
    accountId: "acc_acme",
    dealId: "deal_fs",
    ownerId,
    createdAt: now - 10 * 24 * 60 * 60 * 1000,
    companyName: "Acme Corp",
    domain: "acme.com",
    prospectEmails: ["alex@acme.com"],
  },
  {
    id: "prep_3",
    accountId: "acc_pioneer",
    dealId: "deal_pioneer",
    ownerId,
    createdAt: now - 2 * 24 * 60 * 60 * 1000,
    companyName: "Pioneer Metering",
    domain: "pioneermetering.co.za",
    prospectEmails: ["sunil@pioneermetering.co.za"],
  },
];

const deals = [
  {
    id: "deal_fd",
    accountId: "acc_acme",
    title: "Freshdesk Omni",
    type: "new_business",
    stage: "demo",
  },
  {
    id: "deal_fs",
    accountId: "acc_acme",
    title: "Freshservice",
    type: "new_business",
    stage: "discovery",
  },
  {
    id: "deal_pioneer",
    accountId: "acc_pioneer",
    title: "New business",
    type: "new_business",
    stage: "demo",
  },
];

const participants = ["sunil@acme.com", "se@freshworks.com"];

const account = resolveAccountMatch(briefs, accounts, participants, ownerId, "Acme demo", now);
assert.ok(account);
assert.equal(account!.accountId, "acc_acme");
assert.ok(account!.reasons.some((r) => r.rank === 1));

const ranked = rankDealsOnAccount(account!, deals, briefs, participants, ownerId, "Acme demo", now);
assert.equal(ranked.length, 2, "returns all deals on account");
assert.equal(ranked[0].dealId, "deal_fd");
assert.equal(ranked[0].preselected, true);
assert.equal(ranked[1].dealId, "deal_fs");

const pioneerHit = resolveAccountMatch(
  briefs,
  accounts,
  ["sunil@pioneermetering.co.za"],
  ownerId,
  undefined,
  now,
);
assert.equal(pioneerHit?.accountId, "acc_pioneer");

assert.ok(isFreeMailDomain("gmail.com"));
assert.deepEqual(extractEmailsFromText("reach me at sunil@acme.com thanks"), ["sunil@acme.com"]);
assert.equal(suggestedCompanyName("Acme Corp demo call", ["raj@gmail.com"]), "Acme Corp");

const transcriptOnly = await runPostCallResolve({
  transcript: "SE: Hello sunil@acme.com\nProspect: Thanks for the demo.",
  companyName: "Acme Corp",
  participantEmails: ["sunil@acme.com"],
  ownerId,
  briefs,
  accounts,
  deals,
});
assert.equal(transcriptOnly.sourceKind, "transcript");
assert.equal(transcriptOnly.videoAvailable, false);
assert.equal(transcriptOnly.analysisConfidence, 0.55);
assert.equal(transcriptOnly.videoThemesNotApplicable.length, VIDEO_DEPENDENT_THEME_KEYS.length);
assert.ok(transcriptOnly.videoThemesNotApplicable.every((t) => t.applicable === false));
assert.equal(transcriptOnly.account?.accountId, "acc_acme");

const roles = inferCallIdentities(
  ["Priyal | AE @Freshworks", "Sathish Kuttan", "Harshveer"],
  ["harshveer@euphotic.io"],
);
assert.equal(roles.aeIdentity, "Priyal | AE @Freshworks");
assert.equal(roles.seIdentity, "Sathish Kuttan");
assert.ok(roles.customerIdentities.includes("Harshveer"));
assert.ok(!roles.customerIdentities.includes("Sathish Kuttan"));
assert.ok(!roles.seIdentity?.includes("AE"));

const rolesWithOwner = inferCallIdentities(
  ["Priyal | AE @Freshworks", "Sathish Kuttan", "Harshveer"],
  ["harshveer@euphotic.io"],
  "sathish@freshworks.com",
  "Sathish Kuttan",
);
assert.equal(rolesWithOwner.seIdentity, "Sathish Kuttan");
assert.equal(rolesWithOwner.aeIdentity, "Priyal | AE @Freshworks");

const rolesWithSeEmailInProspects = inferCallIdentities(
  ["Priyal | AE @Freshworks", "Sathish Kuttan", "Harshveer"],
  ["harshveer@euphotic.io", "se@freshworks.com"],
  "se@freshworks.com",
  "Alex SE",
);
// Logged-in reviewer is Alex SE, but call SE is Sathish — never pick the AE.
assert.equal(rolesWithSeEmailInProspects.seIdentity, "Sathish Kuttan");
assert.ok(!rolesWithSeEmailInProspects.customerIdentities.includes("se@freshworks.com"));
assert.equal(rolesWithSeEmailInProspects.aeIdentity, "Priyal | AE @Freshworks");

// Agent 2 — kaiaHost (isHost mapped to a strong Primary-SE hint). No titled speaker at all
// (e.g. a Kaia-summary-only call with plain names) — the Kaia host wins seIdentity.
const rolesWithKaiaHostOnly = inferCallIdentities(
  ["Priyal Shah", "Harshveer"],
  ["harshveer@euphotic.io"],
  undefined,
  undefined,
  "Priyal Shah",
);
assert.equal(rolesWithKaiaHostOnly.seIdentity, "Priyal Shah", "Kaia host wins with no stronger signal");

// An explicit SE-titled transcript speaker still outranks the Kaia host hint.
const rolesWithTitledSpeakerOverKaiaHost = inferCallIdentities(
  ["Sathish Kuttan | SE @Freshworks", "Harshveer"],
  ["harshveer@euphotic.io"],
  undefined,
  undefined,
  "Priyal Shah",
);
assert.equal(
  rolesWithTitledSpeakerOverKaiaHost.seIdentity,
  "Sathish Kuttan | SE @Freshworks",
  "a real SE-titled speaker still beats the Kaia host hint",
);

// A Kaia host whose display name happens to look AE-titled is never used as the SE hint.
const rolesWithAeLikeKaiaHost = inferCallIdentities(
  ["Harshveer"],
  ["harshveer@euphotic.io"],
  undefined,
  undefined,
  "Priyal | AE @Freshworks",
);
assert.notEqual(rolesWithAeLikeKaiaHost.seIdentity, "Priyal | AE @Freshworks");

// Typed prospect email + Kaia first-name typo (Andirius vs andrius) must count as the
// same customer, so the email is not a second identity and Andirius is not the SE.
const andriusKaiaTypo = inferCallIdentities(
  ["Andirius", "Shamron", "Alex SE"],
  ["andrius.salasevicius@invertus.eu", "se@freshworks.com"],
  "se@freshworks.com",
  "Alex SE",
);
assert.equal(andriusKaiaTypo.seIdentity, "Alex SE", "titled Alex SE stays SE");
assert.ok(
  andriusKaiaTypo.customerIdentities.some((s) => /andirius/i.test(s)),
  "Kaia Andirius is a customer (matches typed email)",
);
assert.ok(
  !andriusKaiaTypo.customerIdentities.includes("andrius.salasevicius@invertus.eu"),
  "typed email collapses into the matching Kaia speaker",
);
assert.ok(
  andriusKaiaTypo.customerIdentities.some((s) => /shamron/i.test(s)),
  "Shamron stays a separate customer",
);
assert.ok(
  !andriusKaiaTypo.customerIdentities.some((s) => /alex/i.test(s)),
  "Alex SE is not a customer",
);

const MATT_EMAIL = "matthewn@learnprogroup.com";
const mattKaia = inferCallIdentities(
  ["Alex SE", "Nivi", "Aishwarya Krishna", "Matt Newman"],
  [MATT_EMAIL, "se@freshworks.com"],
  "se@freshworks.com",
  "Nivi",
);
assert.ok(
  mattKaia.customerIdentities.some((s) => /matt newman/i.test(s)),
  "Kaia Matt Newman is a customer (matches typed email)",
);
assert.ok(
  !mattKaia.customerIdentities.includes(MATT_EMAIL),
  "typed matthewn@ email collapses into the matching Kaia speaker",
);
assert.notEqual(mattKaia.seIdentity, "Matt Newman", "Matt is not classified as SE");
assert.ok(
  !mattKaia.customerIdentities.some((s) => /nivi/i.test(s) && /matt/i.test(s)),
  "Nivi is not fused into the Matt customer identity",
);

// B3 — speaker attribution is an LLM call that only the interactive confirm-page flow
// (options.attributeSpeakers: true) should pay for. The legacy/auto-pick path and any other
// caller that omits the flag must never reach the network, even with a transcript that has
// timestamps and a providerEnv configured.
const timestampedTranscript = [
  "WEBVTT",
  "",
  "00:00:00.000 --> 00:00:05.000",
  "Meeting Room: Thanks everyone for joining today.",
  "",
  "00:00:05.500 --> 00:00:12.000",
  "Meeting Room: Happy to walk through the demo.",
].join("\n");

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("must not call the network when attributeSpeakers is not set");
}) as typeof fetch;

try {
  const withoutFlag = await runPostCallResolve(
    {
      transcript: timestampedTranscript,
      companyName: "Acme Corp",
      participantEmails: ["sunil@acme.com"],
      ownerId,
      briefs,
      accounts,
      deals,
    },
    { providerEnv: { GEMINI_API_KEY: "test-key" } as never },
  );
  assert.equal(fetchCalls, 0, "no network call without attributeSpeakers");
  assert.equal(withoutFlag.speakerAttribution, undefined, "no suggestion surfaced without attributeSpeakers");
} finally {
  globalThis.fetch = originalFetch;
}

/**
 * A Freshworks Zoom share link is no longer refused outright just for being on that
 * domain -- only some Freshworks recordings actually force a recaptcha, and only the
 * scrape itself (zoomShare.ts) can tell which. These two mock the scrape's own HTTP
 * calls (no real network) to prove both branches of that per-link decision.
 */
function mockZoomShareFetch(routes: { match: RegExp; body: string }[]): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) throw new Error(`test bug: unmocked Zoom fetch for ${url}`);
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => null, getSetCookie: () => [] as string[] },
      async text() {
        return route.body;
      },
    } as unknown as Response;
  }) as typeof fetch;
}

{
  const withRecaptcha = globalThis.fetch;
  globalThis.fetch = mockZoomShareFetch([
    { match: /play\/share-info\//, body: JSON.stringify({ result: { needRecaptcha: true } }) },
  ]);
  try {
    await runPostCallResolve({
      recordingUrl: "https://freshworks.zoom.us/rec/share/abc123def456ghi789jkl012mno345",
      companyName: "Acme Corp",
      participantEmails: ["sunil@acme.com"],
      ownerId,
    });
    assert.fail("expected a recaptcha error once the share-info call reports needRecaptcha");
  } catch (err) {
    assert.match((err as Error).message, /reCAPTCHA/);
    assert.match((err as Error).message, /Server-to-Server OAuth/);
    assert.equal((err as { status?: number }).status, 400);
  } finally {
    globalThis.fetch = withRecaptcha;
  }
}

{
  // The recording this ticket was about: no recaptcha gate hit, so the scrape should
  // succeed end-to-end -- transcript AND the video stream URL -- with no Zoom OAuth
  // env configured at all. This is the case the old blanket domain check refused.
  const withoutRecaptcha = globalThis.fetch;
  globalThis.fetch = mockZoomShareFetch([
    {
      match: /play\/share-info\//,
      body: JSON.stringify({
        result: { componentName: "rec-play", redirectUrl: "/rec/play/xyz", fileId: "file123" },
      }),
    },
    { match: /rec\/play\/xyz/, body: "<html>ok</html>" },
    {
      match: /play\/info\/file123/,
      body: JSON.stringify({
        result: {
          transcriptUrl: "/nws/recording/1.0/play/transcript/file123",
          meet: { topic: "Acme Sync" },
          viewMp4Url: "/nws/recording/1.0/play/media/file123.mp4",
          hasTranscript: true,
        },
      }),
    },
    {
      match: /play\/transcript\/file123/,
      body: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nRep: Thanks for joining today.\n",
    },
  ]);
  try {
    const resolved = await runPostCallResolve({
      recordingUrl: "https://freshworks.zoom.us/rec/share/abc123def456ghi789jkl012mno345",
      companyName: "Acme Corp",
      participantEmails: ["sunil@acme.com"],
      ownerId,
    });
    assert.match(resolved.transcript, /Thanks for joining today/, "transcript should come from the scraped VTT");
    assert.equal(resolved.sources.zoom?.topic, "Acme Sync");
    assert.ok(resolved.videoAvailable, "the scraped media stream should mark video as available");
    assert.equal(resolved.media?.streams?.length, 1);
  } finally {
    globalThis.fetch = withoutRecaptcha;
  }
}

try {
  await runPostCallResolve({
    recordingUrl: "https://freshworks.zoom.us/j/123456789",
    companyName: "Acme Corp",
    participantEmails: ["sunil@acme.com"],
    ownerId,
  });
  assert.fail("expected join-link error");
} catch (err) {
  assert.match((err as Error).message, /meeting join link/);
  assert.equal((err as { status?: number }).status, 400);
}

console.log("test-postcall-resolve: ok");
