/** Smoke test renderPostCall with v4/v5/malformed shapes (no DOM). */
globalThis.document = { getElementById: () => null };

const { renderPostCall, renderQipScorecard } = await import("../postcall.js");

function indexOf(html, needle) {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
}

function assertOrder(html, labels) {
  let last = -1;
  for (const label of labels) {
    const i = indexOf(html, label);
    if (i <= last) throw new Error(`order failed at ${label}: ${i} <= ${last}`);
    last = i;
  }
}

const cases = [
  ["empty", {}],
  ["no analysis", { transcriptMeta: {} }],
  ["undefined analysis", { analysis: undefined }],
  ["legacy callSummary", { analysis: { callSummary: { headline: "Old call" } } }],
  ["v5 partial no callHeader", { analysis: { momentum: { status: "Stalled", reason: "x", topAction: "a", topActionDue: "d" } } }],
  ["callHeader no attendees", { analysis: { callHeader: { title: "T" }, momentum: { status: "Stalled" } } }],
  ["root attendees v4", { analysis: { attendees: [{ name: "A", role: "SE", influence: "high" }], momentum: { status: "Advancing" } } }],
  ["callSummary.attendees v4", { analysis: { callSummary: { headline: "H", attendees: [{ name: "B", role: "VP", influence: "high" }] }, momentum: { status: "Stalled" } } }],
  ["full v5 sample", {
    analysis: {
      callHeader: { title: "Demo", duration: "45 min", date: "Jul 15", attendees: [{ name: "Jane", role: "VP", influence: "high" }] },
      momentum: { status: "Advancing", reason: "Strong next steps", topAction: "Send POC", topActionDue: "Friday" },
      followUpTable: [],
      signals: { painsConfirmed: [], objectionsOpen: [], competitors: [] },
      nextSteps: [],
      qualityCoach: { dimensions: [], strengths: [], improvements: [], missedOpportunities: [] },
      artifacts: { suggestedFollowUpEmail: { subject: "", body: "" }, crmNotes: "" },
    },
    transcriptMeta: { wordCount: 100 },
  }],
  ["risk row from missed opportunity", {
    analysis: {
      callHeader: { title: "Demo", duration: "45 min", date: "Jul 15", attendees: [{ name: "Sam", role: "SE", influence: "high" }] },
      momentum: { status: "At risk", reason: "No exec sponsor", topAction: "Book exec", topActionDue: "Next week" },
      followUpTable: [{ category: "ae_action", thisCall: "Send recap", followUp: "Share recording" }],
      signals: { painsConfirmed: [], objectionsOpen: [], competitors: [] },
      nextSteps: [{ owner: "AE", action: "Send recap email", due: "Today", why: "Keep momentum", isRisk: false }],
      qualityCoach: {
        dimensions: [],
        strengths: [],
        improvements: [],
        missedOpportunities: ["Probe budget timeline on next call"],
      },
      artifacts: { suggestedFollowUpEmail: { subject: "", body: "" }, crmNotes: "" },
    },
  }],
  ["dedupe next steps vs follow-up", {
    analysis: {
      callHeader: { title: "Demo", duration: "45 min", date: "Jul 15", attendees: [] },
      momentum: { status: "Stalled", reason: "Awaiting review", topAction: "Follow up", topActionDue: "Friday" },
      followUpTable: [{ category: "se_action", thisCall: "Demo complete", followUp: "Send pricing link" }],
      signals: { painsConfirmed: [], objectionsOpen: [], competitors: [] },
      nextSteps: [
        { owner: "SE", action: "Send pricing link", due: "Tomorrow", why: "Requested on call", isRisk: false },
        { owner: "Customer", action: "Internal security review", due: "Next week", why: "Gate before POC", isRisk: false },
      ],
      qualityCoach: { dimensions: [], strengths: [], improvements: [], missedOpportunities: [] },
      artifacts: { suggestedFollowUpEmail: { subject: "", body: "" }, crmNotes: "" },
    },
  }],
  ["pass7 call notes and mom", {
    analysis: {
      callHeader: { title: "Demo", duration: "45 min", date: "Jul 24", attendees: [{ name: "Pat", role: "SE", influence: "high" }] },
      momentum: { status: "Stalled", reason: "No customer next step", topAction: "Get owner", topActionDue: "Monday" },
      followUpTable: [],
      signals: { painsConfirmed: [], objectionsOpen: [], competitors: [] },
      nextSteps: [],
      qualityCoach: { dimensions: [], strengths: [], improvements: [], missedOpportunities: [] },
      artifacts: { suggestedFollowUpEmail: { subject: "", body: "" }, crmNotes: "" },
      callNotes: "The call ended without a customer-owned next step, which is what turned a good demo into 60 days of silence.",
    },
    summarise: {
      followUps: [
        { description: "Send POC plan", owner: "se", dueDate: "Friday", status: "open", sourceQuote: "Send a plan" },
      ],
      objections: [
        { objectionText: "Price vs Zendesk", handling: "Value walkthrough", landed: false, theme: "pricing" },
      ],
      momDraft: {
        draftBody: "Thanks for joining. Decision: proceed to POC. Action: SE to send plan by Friday.",
        editedBody: null,
        sentAt: null,
        sentBy: null,
      },
    },
  }],
  ["v2 QIP scorecard render", {
    analysis: {
      analysisVersion: 2,
      rubricVersion: "2.1",
      callHeader: { title: "Acme demo", duration: "40 min", date: "Jul 24", attendees: [{ name: "Pat", role: "SE", influence: "high" }] },
      momentum: { status: "Advancing", reason: "Clear next step", topAction: "Send POC plan", topActionDue: "Friday" },
      followUpTable: [],
      signals: { painsConfirmed: [], objectionsOpen: [], competitors: [] },
      nextSteps: [],
      qualityCoach: { dimensions: [], strengths: [], improvements: [], missedOpportunities: [] },
      artifacts: { suggestedFollowUpEmail: { subject: "", body: "" }, crmNotes: "" },
    },
    analysisMeta: { callType: "demo", provisional: false, analysisConfidence: 0.82, rubricVersion: "2.1" },
    scorecard: {
      callType: "demo",
      rubricVersion: "2.1",
      provisional: false,
      overall: 7.8,
      confidence: 0.82,
      categoryScores: {
        discovery_qualification: 8,
        solution_technical_fit: 8,
        business_value: 7,
        credibility_objections: 7,
        communication_control: 6,
      },
      lines: [
        {
          themeKey: "solutioning",
          grade: 8,
          credit: 3,
          category: "solution_technical_fit",
          applicable: true,
          confidence: 0.7,
          subParameters: [
            { score: 2, evidence: [{ atS: 300, quote: "For your agents, ticket routing maps here." }] },
            { score: 2, evidence: [] },
            { score: 1, evidence: [] },
            { score: 2, evidence: [] },
            { score: 1, evidence: [] },
          ],
          coachingNote: "Tie each feature to one named pain.",
        },
        {
          themeKey: "questions",
          grade: 9,
          credit: 3,
          category: "discovery_qualification",
          applicable: true,
          confidence: 0.8,
          subParameters: [
            { score: 2, evidence: [{ atS: 60, quote: "What does success look like in 90 days?" }] },
            { score: 2, evidence: [] },
            { score: 2, evidence: [] },
            { score: 2, evidence: [] },
            { score: 1, evidence: [] },
          ],
          coachingNote: "Ask one quantified follow-up.",
        },
        {
          themeKey: "camera_on",
          grade: 0,
          credit: 2,
          category: "communication_control",
          applicable: false,
          evidenceUnavailable: true,
          notApplicableReason: "No video recording — this theme requires visual evidence from the recording and cannot be scored from transcript alone.",
          confidence: 1,
          subParameters: [],
          coachingNote: null,
        },
      ],
    },
  }],
];

let failed = 0;
for (const [name, data] of cases) {
  try {
    const html = renderPostCall(data, {});
    if (!html || typeof html !== "string") throw new Error("no html");
    if (data.analysis?.momentum?.status) {
      const coachHeading =
        data.scorecard?.lines?.length || data.analysis?.analysisVersion === 2
          ? "QIP scorecard"
          : "Quality coach";
      assertOrder(html, [
        'class="header-strip"',
        'class="outcome-bar outcome-focal momentum-hero',
        "This call → Follow-up",
        "Signals",
        "Next steps",
        coachHeading,
      ]);
    }
    if (name === "risk row from missed opportunity") {
      if (!html.includes('class="risk-row"')) throw new Error("missing risk row");
      if (!html.includes("Probe budget timeline")) throw new Error("missing missed opportunity action");
      if (html.includes("Send recap email")) throw new Error("duplicate follow-up action not removed");
    }
    if (name === "dedupe next steps vs follow-up") {
      const nextSection = html.slice(html.indexOf("Next steps"));
      if (nextSection.includes("Send pricing link")) throw new Error("duplicate send pricing link in next steps");
      if (!nextSection.includes("Internal security review")) throw new Error("unique next step removed");
    }
    if (name === "pass7 call notes and mom") {
      if (!html.includes("Call notes")) throw new Error("missing Call notes heading");
      if (!html.includes("customer-owned next step")) throw new Error("missing call notes body");
      if (!html.includes("Minutes draft")) throw new Error("missing Minutes draft heading");
      if (!html.includes("proceed to POC")) throw new Error("missing MoM body");
      if (!html.includes("Not sent yet")) throw new Error("missing never-sent status");
      if (!html.includes("Commitments")) throw new Error("missing Commitments section");
      if (!html.includes("Send POC plan")) throw new Error("missing follow-up row");
      if (!html.includes("Objections")) throw new Error("missing Objections section");
      if (!html.includes("Price vs Zendesk")) throw new Error("missing objection text");
      // Call notes ≠ MoM — both present independently
      if (!html.includes("Internal: blunt")) throw new Error("missing internal call-notes hint");
      if (!html.includes("Customer-facing")) throw new Error("missing MoM customer-facing hint");
    }
    if (name === "v2 QIP scorecard render") {
      if (!html.includes("QIP scorecard")) throw new Error("missing QIP scorecard heading");
      if (!html.includes("7.8 / 10")) throw new Error("missing overall /10 label");
      if (!html.includes("What worked")) throw new Error("missing what worked tile");
      if (!html.includes("What didn")) throw new Error("missing what didn't tile");
      if (!html.includes("qip-radar-svg")) throw new Error("missing category radar");
      if (!html.includes("qip-category-row")) throw new Error("missing category rows");
      if (!html.includes("qip-theme-row-heavy")) throw new Error("missing heavy credit styling");
      if (!html.includes("qip-theme-row-na")) throw new Error("missing NA styling");
      if (!html.includes("No video recording")) throw new Error("missing NA reason");
      if (!html.includes("05:00") && !html.includes("01:00")) {
        throw new Error("missing timestamped evidence");
      }
      if (html.includes("/ 100") || html.includes("weighted")) {
        throw new Error("legacy /100 or weighted copy rendered");
      }
      if (html.includes('class="qc-dashboard"')) {
        throw new Error("legacy quality coach rendered for v2");
      }
      const provisionalHtml = renderQipScorecard(
        { ...data.scorecard, provisional: true },
        { ...data.analysisMeta, provisional: true },
      );
      if (!provisionalHtml.includes("Provisional")) throw new Error("missing provisional badge");
      const wireframeHtml = renderQipScorecard(data.scorecard, data.analysisMeta, {
        context: "call-record",
      });
      if (!wireframeHtml.includes("qip-scorecard--wireframe")) throw new Error("missing wireframe class");
      if (!wireframeHtml.includes("Override a score")) throw new Error("missing override action");
      if (!wireframeHtml.includes("Compare to my average")) throw new Error("missing compare action");
      if (!wireframeHtml.includes("qip-subparam-list")) throw new Error("missing sub-parameter drill-down");
      if (wireframeHtml.includes("qip-radar-svg")) throw new Error("wireframe QIP tab should not duplicate radar");
      if (!wireframeHtml.includes("Discovery &amp; qualification")) throw new Error("missing human category label");
      if (wireframeHtml.includes("Coach note coming in a later pass.")) {
        throw new Error("coach placeholder still rendered");
      }
      const coachNote = renderQipScorecard(data.scorecard, data.analysisMeta, {
        overrides: [],
      });
      if (!coachNote.includes("On the next call") && !coachNote.includes("You started this")) {
        throw new Error("missing sub-parameter coach note");
      }
      if (!coachNote.includes("05:00") && !coachNote.includes("01:00")) {
        throw new Error("missing coach timestamp anchor");
      }
    }
    console.log("OK:", name, `(${html.length} chars)`);
  } catch (e) {
    console.error("FAIL:", name, e.message);
    failed++;
  }
}

if (failed) process.exit(1);
console.log("All renderPostCall cases passed");
