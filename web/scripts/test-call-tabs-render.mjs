/** Call-view tabs — TC, deal health, Kaia-style minutes (no DOM). */
import assert from "node:assert/strict";
import { renderMinutesTab, resolveMinutesViewModel } from "../call-view.js";

function testKaiaMinutesFromStructured() {
  const html = renderMinutesTab(
    {},
    {
      momDraft: {
        outcome: "Evaluated Freshworks as a Salesforce replacement and agreed a trial.",
        keyPoints: [
          { title: "Omnichannel support", detail: "Unified inbox." },
          { title: "Security and compliance", detail: null },
        ],
        actionItems: [
          {
            text: "Follow up via email on open questions",
            owner: "se",
            atS: 372,
          },
        ],
        draftBody: "Flat body for email",
      },
    },
  );

  assert.match(html, /Outcome/);
  assert.match(html, /Salesforce replacement/);
  assert.match(html, /Key points/);
  assert.match(html, /Omnichannel support/);
  assert.match(html, /Action items/);
  assert.match(html, /6:12/);
  assert.match(html, /Suggested from call/);
  assert.match(html, /Edit flat draft/);
  assert.doesNotMatch(html, /Phase 2/);
}

function testLegacyFlatMomStillRenders() {
  const html = renderMinutesTab({
    result: {
      summarise: {
        momDraft: { draftBody: "Thanks for your time. Next step: send the POC plan." },
        followUps: [{ description: "Send POC plan", owner: "se", dueDate: "Friday" }],
      },
    },
  });
  assert.match(html, /Outcome/);
  assert.match(html, /POC plan/);
  assert.match(html, /Action items/);
  assert.match(html, /Send POC plan/);
}

function testEmptyMinutes() {
  const html = renderMinutesTab({});
  assert.match(html, /No minutes draft yet/);
}

function testResolveFallsBackToFollowUps() {
  const view = resolveMinutesViewModel(
    { result: { summarise: { momDraft: { draftBody: "Hello outcome" } } } },
    null,
    [{ description: "Book security review", owner: "customer" }],
  );
  assert.equal(view.outcome.includes("Hello"), true);
  assert.equal(view.actionItems.length, 1);
  assert.equal(view.actionItems[0].text, "Book security review");
}

testKaiaMinutesFromStructured();
testLegacyFlatMomStillRenders();
testEmptyMinutes();
testResolveFallsBackToFollowUps();
console.log("test-call-tabs-render: ok");
