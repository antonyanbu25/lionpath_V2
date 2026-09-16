/** Call-view tabs — TC, deal health, wireframe minutes (no DOM). */
import assert from "node:assert/strict";
import { renderMinutesTab, resolveMinutesViewModel } from "../call-view.js";

function testWireframeMinutesFromStructured() {
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

  assert.match(html, /mom-card--wireframe/);
  assert.match(html, /mom-section--outcome/);
  assert.match(html, /mom-section--topics/);
  assert.match(html, /mom-section--actions/);
  assert.match(html, /Minutes of meeting/);
  assert(!html.match(/Customer facing · never auto-sends/));
  assert.match(html, /Salesforce replacement/);
  assert.match(html, /What we covered/);
  assert.match(html, /Omnichannel support/);
  assert.match(html, /Next steps/);
  assert.match(html, /Follow up via email on open questions/);
  assert.match(html, /mom-owner--se/);
  assert.match(html, /6:12/);
  assert.match(html, /Use the below to send an email to the customer/);
  assert.match(html, /Edit email draft/);
  assert.doesNotMatch(html, /Phase 2/);
  assert.match(html, /Meeting outcome/);
  assert.match(html, /Best regards/);
  assert.doesNotMatch(html, /Flat body for email/);
}

function testEmailDraftFormatting() {
  const view = resolveMinutesViewModel(
    { analysis: { callHeader: { title: "Gamersheek Demo", attendees: [{ name: "Jenni Smith", role: "customer" }] } } },
    {
      outcome: "Agreed a 14-day Pro trial.",
      keyPoints: [{ title: "Omnichannel", detail: "Unified inbox." }],
      actionItems: [{ text: "Send trial link", owner: "ae", dueDate: "Friday" }],
      draftBody: "Dear Jenni, Thank you for your time today. Meeting Outcome: everything inline without breaks.",
    },
    [],
  );
  assert.match(view.emailDraft, /^Dear Jenni,/);
  assert.match(view.emailDraft, /\n\nMeeting outcome\n\n/);
  assert.match(view.emailDraft, /\n\nWhat we covered\n\n/);
  assert.match(view.emailDraft, /\n\nNext steps\n\n/);
  assert.match(view.emailDraft, /• Omnichannel — Unified inbox\./);
  assert.match(view.emailDraft, /• Send trial link \(AE, by Friday\)/);
  assert.match(view.editorBody, /Best regards,/);
  assert.doesNotMatch(view.editorBody, /everything inline/);
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
  assert.match(html, /mom-card--wireframe/);
  assert.match(html, /mom-section--outcome/);
  assert.match(html, /mom-section--actions/);
  assert.match(html, /Minutes of meeting/);
  assert.match(html, /POC plan/);
  assert.match(html, /Next steps/);
  assert.match(html, /Send POC plan/);
  assert.match(html, /mom-owner--se/);
  assert.match(html, /By Friday/);
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

testWireframeMinutesFromStructured();
testEmailDraftFormatting();
testLegacyFlatMomStillRenders();
testEmptyMinutes();
testResolveFallsBackToFollowUps();
console.log("test-call-tabs-render: ok");
