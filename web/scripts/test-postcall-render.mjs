/** Smoke test renderPostCall with v4/v5/malformed shapes (no DOM). */
globalThis.document = { getElementById: () => null };

const { renderPostCall } = await import("../postcall.js");

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
];

let failed = 0;
for (const [name, data] of cases) {
  try {
    const html = renderPostCall(data, {});
    if (!html || typeof html !== "string") throw new Error("no html");
    if (data.analysis?.momentum?.status) {
      assertOrder(html, [
        'class="header-strip"',
        'class="outcome-bar outcome-focal momentum-hero',
        "This call → Follow-up",
        "Signals",
        "Next steps",
        "Quality coach",
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
    console.log("OK:", name, `(${html.length} chars)`);
  } catch (e) {
    console.error("FAIL:", name, e.message);
    failed++;
  }
}

if (failed) process.exit(1);
console.log("All renderPostCall cases passed");
