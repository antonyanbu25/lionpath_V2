#!/usr/bin/env node
/**
 * UAT-008 regression gate: "missed attendee" (2026-09-11 staging UAT).
 *
 * ROOT CAUSE: there are two independent sources of "who was on this call".
 *
 *   1. The CONFIRMED roster — built by postcall.js's readAttendeeSelections()
 *      from the confirm-step UI the user explicitly reviewed before
 *      submitting for analysis, covering every role (SE, secondary SE, AE,
 *      customer, partner, manager, executive, room members). This whole
 *      object is persisted verbatim as record.confirmedIdentities (see
 *      history.js's savePostCallAnalysis: `confirmedIdentities:
 *      input?.confirmedIdentities || null`), including the full
 *      `.attendees` array.
 *   2. The LLM's OWN attendee list — analysis.callHeader.attendees,
 *      populated independently by whatever the model inferred from reading
 *      the transcript text. This can miss someone who spoke little or was
 *      never clearly named.
 *
 * Multiple call-view.js consumers read analysis.callHeader.attendees (or
 * hdr.attendees) directly, with no reconciliation against the
 * already-persisted confirmed roster — so a person the user explicitly
 * confirmed could silently vanish from every downstream view. The most
 * concrete, user-visible consequence: resolveMomGreetingName picks the
 * first attendee whose role matches /customer|prospect|buyer|client/ to use
 * as the first name in the auto-drafted Minutes-of-Meeting email greeting
 * ("Hi Sarah,"). If the confirmed customer is missing from the LLM's list,
 * this falls through to greetingNameFromDraft, a text-scraping fallback
 * that can pick up the wrong name (or none) from the transcript body.
 *
 * THE FIX: resolveCallAttendees(record) additively unions the LLM's list
 * with any confirmedIdentities.attendees entries missing from it (matched
 * by normalizePersonKey on name/email/label — the same key scheme
 * mergeCallIdentities already uses elsewhere in this file). It never
 * removes or overrides an LLM-derived attendee already present under the
 * same identity, and degrades to "just the LLM's list" when
 * confirmedIdentities (or .attendees) is absent, since plenty of
 * existing/older saved records predate that field.
 *
 * This file proves, section by section:
 *   1. resolveCallAttendees reconciles a missing confirmed attendee in.
 *   2. resolveMinutesViewModel's MoM greeting now uses the confirmed
 *      customer's name instead of falling through to the text-scraping
 *      fallback — reproduced against the OLD pre-fix behavior first (reading
 *      hdr.attendees directly, as call-view.js used to) to prove the fixture
 *      actually reproduces the bug, then against the real fixed function.
 *   3. A record with NO confirmedIdentities at all still works exactly as
 *      before — same attendees list, no crash.
 *   4. Existing LLM-derived attendees are never removed or overridden by a
 *      confirmed entry under the same identity (additive-only contract).
 */
import assert from "node:assert/strict";
import { resolveCallAttendees, resolveMinutesViewModel } from "../call-view.js";
import { greetingNameFromDraft } from "../shared/mom-email-draft.js";

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The LLM read two attendees off the transcript but never clearly named the
// customer ("Priya Nair") -- she spoke little and was misheard as part of
// the AE's own turn. The user, however, explicitly confirmed her on the
// confirm-step roster (role "Customer") before submitting.
const LLM_ATTENDEES_MISSING_CUSTOMER = [
  { name: "Sam SE", role: "Primary SE" },
  { name: "Alex AE", role: "AE" },
];
const CONFIRMED_ATTENDEES = [
  { name: "Sam SE", email: "sam@fresh.works", role: "Primary SE", label: "Sam SE" },
  { name: "Alex AE", email: "alex@fresh.works", role: "AE", label: "Alex AE" },
  { name: "Priya Nair", email: "priya@acme.com", role: "Customer", label: "Priya Nair" },
];

function recordWith({ attendees, confirmedIdentities } = {}) {
  return {
    id: "rec-1",
    analysis: { callHeader: { title: "Acme Discovery", attendees } },
    confirmedIdentities,
  };
}

// A transcript body whose first mentioned name is NOT the confirmed
// customer -- this is what the text-scraping fallback would latch onto if
// the reconciled attendee list didn't surface Priya first.
const DRAFT_BODY_WITH_WRONG_NAME =
  "Dear Team, Thank you for joining. Meeting Outcome: covered the demo.";

console.log("\n1. resolveCallAttendees additively reconciles a missing confirmed attendee");
check("confirmed customer missing from the LLM's list is added", () => {
  const record = recordWith({
    attendees: LLM_ATTENDEES_MISSING_CUSTOMER,
    confirmedIdentities: { attendees: CONFIRMED_ATTENDEES },
  });
  const reconciled = resolveCallAttendees(record);
  assert.equal(reconciled.length, 3, "expected the LLM's 2 plus the 1 missing confirmed attendee");
  const priya = reconciled.find((a) => a.name === "Priya Nair");
  assert.ok(priya, "confirmed customer Priya Nair must appear in the reconciled list");
  assert.equal(priya.role, "Customer");
});

check("already-present LLM attendees are never duplicated or overridden", () => {
  const record = recordWith({
    // LLM already has its own (slightly noisier) entry for the AE.
    attendees: [
      { name: "Sam SE", role: "Primary SE" },
      { name: "Alex AE", role: "AE", note: "llm-derived, keep exactly this shape" },
    ],
    confirmedIdentities: { attendees: CONFIRMED_ATTENDEES },
  });
  const reconciled = resolveCallAttendees(record);
  // Only Priya (missing) should be added; Sam and Alex's LLM entries pass
  // through untouched -- additive only, never subtractive or overriding.
  assert.equal(reconciled.length, 3);
  const alex = reconciled.find((a) => a.name === "Alex AE");
  assert.equal(alex.note, "llm-derived, keep exactly this shape", "LLM's own Alex entry must be untouched, not replaced by the confirmed one");
});

console.log("\n2. MoM greeting: confirmed customer now wins over the text-scraping fallback");

/**
 * Local copy of resolveMomGreetingName's matching logic (that function isn't
 * exported). Used only to compare the SAME greeting-resolution logic against
 * two different attendee sources: the raw LLM list (the old, buggy shape --
 * `const attendees = hdr.attendees || [];`) vs. resolveCallAttendees'
 * reconciled list (the fix). The real end-to-end assertion against the
 * shipped fix is the resolveMinutesViewModel check further down.
 */
function greetingCustomerFirstName(attendees, draftBody) {
  const customer = (attendees || []).find((a) =>
    /customer|prospect|buyer|client/i.test(String(a?.role || a?.type || a?.side || "")),
  );
  const name = customer?.name || customer?.displayName || "";
  if (name.trim()) return name.trim().split(/\s+/)[0];
  return greetingNameFromDraft(draftBody);
}

check("FAILS BEFORE — reading hdr.attendees directly (pre-fix shape) grabs the WRONG name from the transcript body", () => {
  // preFixAttendees is exactly the old call-view.js shape being replaced:
  //   const attendees = hdr.attendees || [];
  // i.e. no reconciliation against confirmedIdentities at all.
  const preFixAttendees = LLM_ATTENDEES_MISSING_CUSTOMER;
  const greeting = greetingCustomerFirstName(preFixAttendees, DRAFT_BODY_WITH_WRONG_NAME);
  assert.equal(
    greeting,
    "Team",
    "pre-fix: no confirmed customer in the raw LLM list, so it falls through to the text-scraping " +
      "fallback and grabs \"Team\" off \"Dear Team,\" in the transcript body -- the wrong name, not the confirmed customer Priya",
  );
});

check("PASSES AFTER — resolveCallAttendees-reconciled attendees produce the confirmed customer's name", () => {
  const record = recordWith({
    attendees: LLM_ATTENDEES_MISSING_CUSTOMER,
    confirmedIdentities: { attendees: CONFIRMED_ATTENDEES },
  });
  const reconciledAttendees = resolveCallAttendees(record);
  const greeting = greetingCustomerFirstName(reconciledAttendees, DRAFT_BODY_WITH_WRONG_NAME);
  assert.equal(greeting, "Priya", "post-fix: the confirmed customer, now present in the reconciled list, wins over the text-scraping fallback");
});

check("PASSES AFTER (integration) — resolveMinutesViewModel's emailDraft greets the confirmed customer by name", () => {
  const record = recordWith({
    attendees: LLM_ATTENDEES_MISSING_CUSTOMER,
    confirmedIdentities: { attendees: CONFIRMED_ATTENDEES },
  });
  const view = resolveMinutesViewModel(
    record,
    { outcome: "Covered the demo.", draftBody: DRAFT_BODY_WITH_WRONG_NAME },
    [],
  );
  assert.match(view.emailDraft, /^Dear Priya,/, "MoM greeting must use the confirmed customer's first name, not the text-scraping fallback, end-to-end through resolveMinutesViewModel");
});

console.log("\n3. No confirmedIdentities at all — behaves exactly as before (no crash, LLM list unchanged)");

check("resolveCallAttendees degrades to just the LLM's list", () => {
  const record = recordWith({ attendees: LLM_ATTENDEES_MISSING_CUSTOMER, confirmedIdentities: undefined });
  const reconciled = resolveCallAttendees(record);
  assert.deepEqual(reconciled, LLM_ATTENDEES_MISSING_CUSTOMER);
});

check("resolveCallAttendees degrades gracefully when confirmedIdentities.attendees is missing (older record shape)", () => {
  const record = recordWith({
    attendees: LLM_ATTENDEES_MISSING_CUSTOMER,
    confirmedIdentities: { seIdentity: "Sam SE" }, // pre-attendees confirmedIdentities shape
  });
  const reconciled = resolveCallAttendees(record);
  assert.deepEqual(reconciled, LLM_ATTENDEES_MISSING_CUSTOMER);
});

check("resolveCallAttendees never throws on a record with no analysis at all", () => {
  assert.doesNotThrow(() => resolveCallAttendees({}));
  assert.deepEqual(resolveCallAttendees({}), []);
});

check("resolveMinutesViewModel on a record with no confirmedIdentities falls back exactly as before", () => {
  const record = recordWith({ attendees: LLM_ATTENDEES_MISSING_CUSTOMER, confirmedIdentities: undefined });
  const view = resolveMinutesViewModel(
    record,
    { outcome: "Covered the demo.", draftBody: DRAFT_BODY_WITH_WRONG_NAME },
    [],
  );
  // No confirmed customer available -- must fall through to the same
  // text-scraping fallback the pre-fix code always used.
  const expectedFallback = greetingNameFromDraft(DRAFT_BODY_WITH_WRONG_NAME);
  const expectedGreeting = expectedFallback ? `Dear ${expectedFallback},` : "Dear ,";
  assert.ok(
    view.emailDraft.startsWith(expectedGreeting) || (!expectedFallback && !view.emailDraft.startsWith("Dear")),
    `expected greeting to match the pre-fix fallback behavior, got: ${view.emailDraft.slice(0, 40)}`,
  );
});

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("OK — UAT-008 attendee-reconciliation gate passed.");
