/**
 * Smoke tests — call record view renders from local history without Firestore profile.
 */
import { initDomainStore } from "../domain/store.js";
import { savePostCallAnalysis, getPostCallAnalysis } from "../history.js";
import { renderCallView } from "../call-view.js";
import {
  effectiveSessionUserId,
  withEffectiveUserId,
} from "../domain/session.js";
import { stableUserIdForEmail } from "../domain/id.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
  key: (i) => [...storeData.keys()][i] ?? null,
  get length() {
    return storeData.size;
  },
};
globalThis.sessionStorage = {
  getItem: (k) => storeData.get(`ss:${k}`) ?? null,
  setItem: (k, v) => storeData.set(`ss:${k}`, v),
  removeItem: (k) => storeData.delete(`ss:${k}`),
};

initDomainStore(null);

const email = "se@freshworks.com";

/** Firebase SSO shape when Firestore upsert fails — email + authUid only. */
const firebaseSession = {
  role: "se",
  email,
  name: "Test SE",
  authUid: "firebase-auth-uid-abc123",
  teamId: "team_ajay",
};

assert(
  effectiveSessionUserId(firebaseSession) === stableUserIdForEmail(email),
  "effectiveSessionUserId falls back to stable id from email",
);
const enriched = withEffectiveUserId(firebaseSession);
assert(
  enriched.userId === stableUserIdForEmail(email),
  "withEffectiveUserId assigns stable domain id",
);
assert(enriched.uid === enriched.userId, "uid mirrors userId");

const saved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/sso-test" },
  {
    analysis: {
      callHeader: { title: "Acme · Demo", duration: "48 min", attendees: [{ name: "Pat", role: "Customer" }] },
      callNotes: "- Strong demo overall.\n- Pricing objection surfaced at 35m and was not fully closed.",
      momentum: { status: "Advancing" },
    },
    scorecard: {
      callType: "demo",
      rubricVersion: "2.1",
      provisional: false,
      overall: 7.8,
      confidence: 0.85,
      categoryScores: {
        discovery_qualification: 7,
        solution_technical_fit: 8,
        business_value: 7,
        credibility_objections: 7,
        communication_control: 7.8,
      },
      lines: [{
        themeKey: "call_flow",
        grade: 7.8,
        credit: 3,
        category: "communication_control",
        applicable: true,
        subParameters: [{ score: 2, evidence: [] }, { score: 2, evidence: [] }, { score: 1, evidence: [] }, { score: 2, evidence: [] }, { score: 1, evidence: [] }],
      }],
    },
    analysisMeta: { callType: "demo", analysisConfidence: 0.85 },
  },
);
assert(saved?.id, "history save returned record id");
const callId = saved.id;
assert(getPostCallAnalysis(email, callId)?.id === callId, "record readable from local history");

const container = { innerHTML: "" };
Object.defineProperty(container, "querySelector", {
  value: () => null,
  configurable: true,
});
Object.defineProperty(container, "querySelectorAll", {
  value: () => [],
  configurable: true,
});

await renderCallView(container, firebaseSession, { callId });

assert(container.innerHTML.includes("call-record"), "renders call record shell");
assert(!container.innerHTML.includes("call-record--loading"), "finished render replaces loading shell");
assert(container.innerHTML.includes("Acme · Demo"), "shows call title");
assert(container.innerHTML.includes("call-postcall-summary-row"), "shows KPI+star+room row");
assert(container.innerHTML.includes('class="metrics"'), "shows metrics column");
assert(container.innerHTML.includes("Call Quality Score"), "shows Call Quality Score KPI");
assert(container.innerHTML.includes("Qualification · MEDDPICC"), "shows MEDDPICC KPI");
assert(container.innerHTML.includes("How the 48 minutes went"), "timeline title from duration");
assert(!container.innerHTML.includes("call-spine-metrics"), "metrics strip removed from timeline");
assert(!container.innerHTML.includes("Call 3 of 3"), "no call sequence phrasing");
assert(!container.innerHTML.includes("call-record-notes-row"), "old notes+room row removed");
assert(!container.innerHTML.includes("← All calls"), "no All calls back button");
assert(!container.innerHTML.includes("Transcript-only call"), "no transcript-only dev copy");
const starCount = (container.innerHTML.match(/class="[^"]*\bqip-star-svg\b[^"]*"/g) || []).length;
assert(starCount === 1, "QIP radar shown once at top");
assert(container.innerHTML.includes('viewBox="0 0 600 500"'), "radar uses labs 600x500 viewBox");
assert(container.innerHTML.includes("qip-radar-ring"), "radar has pentagon grid rings");
assert(!container.innerHTML.match(/<circle class="ring r\d"/), "radar grid uses pentagons not circles");
const dataMatch = container.innerHTML.match(/class="qip-radar-data" points="([^"]+)"/);
const radarVerts = dataMatch ? dataMatch[1].trim().split(/\s+/).length : 0;
assert(radarVerts === 5, "radar data polygon is 5-vertex pentagon not 10-vertex star");
assert(container.innerHTML.includes("qip-radar-ring-outer"), "radar has outer pentagon boundary at score 10");
assert(container.innerHTML.includes("star-overall-pill"), "overall score in header pill");
assert(container.innerHTML.includes(">7.8<"), "overall QIP score shown in header pill");
assert(container.innerHTML.includes("qip-star-animated"), "star has entrance animations");
assert(container.innerHTML.includes("qip-radar-wash"), "radar has multi-colour wash");
assert(!container.innerHTML.includes("qip-star-core"), "no center score core");
assert(!container.innerHTML.includes('viewBox="0 0 700 600"'), "old 700x600 radar removed");
assert(container.innerHTML.includes("qip-weight-key"), "scorecard has weight key near score");
assert(container.innerHTML.includes('class="wt"'), "scorecard has weight bars");
assert(!container.innerHTML.includes('class="legend"'), "verbose scorecard legend removed");
assert(!container.innerHTML.includes("How to read this"), "how-to-read copy removed");
assert(container.innerHTML.includes('class="pill high"') || container.innerHTML.includes('class="pill med"'), "scorecard uses wireframe confidence pills");
assert(container.innerHTML.includes("qip-radar-data"), "radar has filled score polygon");
assert(!container.innerHTML.includes("-dataClip"), "radar no longer uses wedge clipPath fill");
assert(!container.innerHTML.includes("Demo profile"), "no profile version subline on KPI");
assert(!container.innerHTML.includes('viewBox="0 0 400 400"'), "old 400x400 radar removed");
assert(container.innerHTML.includes("Who was in the room"), "shows room panel");
assert(container.innerHTML.includes("Call Quality Score"), "shows Call Quality Score tab");
assert(!container.innerHTML.includes("Call Quality Scorecard"), "no Scorecard suffix on tab");
assert(container.innerHTML.includes("Technical commit"), "shows TC tab");
assert(container.innerHTML.includes("What worked"), "shows what worked tile");
assert(container.innerHTML.includes("What didn"), "shows what didn't tile");
assert(container.innerHTML.includes("/ 10"), "shows /10 scores");
assert(
  !/Call Quality Score[\s\S]{0,120}\/ 100/.test(container.innerHTML),
  "Call Quality Score KPI uses /10 not /100",
);
assert(container.innerHTML.includes("Positive"), "shows positive sentiment for advancing call");
assert(container.innerHTML.includes("Overall call sentiment"), "sentiment KPI on side column");
assert(container.innerHTML.includes("Evaluation signal"), "Call Quality star radar in center column");
assert(container.innerHTML.includes("qip-star-card"), "star sits on white tile card");
assert(!container.innerHTML.includes("background:transparent"), "star card not forced transparent");
assert(!container.innerHTML.includes("from call momentum"), "sentiment not momentum placeholder");
assert(!container.innerHTML.includes("Provisional"), "no provisional badge");
assert(!container.innerHTML.includes("Weighted"), "no weighted column");
assert(container.innerHTML.includes("call-notes-bullets"), "shows call notes bullets");
const notesStart = container.innerHTML.indexOf("call-notes-bullets");
const notesEnd = container.innerHTML.indexOf("</ul>", notesStart);
const notesSection = container.innerHTML.slice(notesStart, notesEnd);
const notesLiCount = (notesSection.match(/<li>/g) || []).length;
assert(notesLiCount <= 3, "call notes capped to 3 lines");
assert(container.innerHTML.includes("Open deal"), "shows open deal action");
assert(!container.innerHTML.includes("Edit notes"), "no edit notes action");
assert(!container.innerHTML.includes("call-notes-editor"), "textarea not mounted until edit mode");
assert(container.innerHTML.includes("Re-run"), "shows re-run action");
assert(
  !container.innerHTML.includes("We could not load your profile"),
  "must not show profile gate error",
);

const camSaved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/cam-test",
    confirmedIdentities: {
      seIdentity: "Sathish Kuttan",
      aeIdentity: "Pradeep Solai",
      customerIdentities: ["Israel"],
    },
  },
  {
    analysis: {
      callHeader: {
        title: "CamCo · Demo",
        duration: "30 min",
        attendees: [{ name: "Pat", role: "Customer" }],
      },
    },
    analysisMeta: { callType: "demo", videoAvailable: true },
    videoFacts: {
      status: "ready",
      streamKind: "video",
      cameraOnPct: 82,
      attendeeCurveJson: [
        { name: "Sathish Kuttan", role: "Solution Engineer", talkPct: 75, cameraOn: true, cameraOnPct: 82 },
        { name: "Pradeep Solai", role: "Account Executive", talkPct: 5, cameraOn: false, cameraOnPct: 12 },
        { name: "Israel", role: "Customer", talkPct: 20, cameraOn: true, cameraOnPct: 60 },
      ],
    },
  },
);
const camContainer = { innerHTML: "" };
Object.defineProperty(camContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(camContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(camContainer, firebaseSession, { callId: camSaved.id });
assert(camContainer.innerHTML.includes("talk 75%"), "shows talk pct from videoFacts");
assert(camContainer.innerHTML.includes("cam On"), "shows camera on when videoFacts has camera data");
assert(camContainer.innerHTML.includes("cam Off"), "shows camera off for AE when vision says off");

const seCamFallbackSaved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/se-cam-fallback",
    confirmedIdentities: {
      seIdentity: "Sathish Kuttan",
      aeIdentity: "Priyal",
      customerIdentities: ["Harshveer"],
    },
  },
  {
    analysis: {
      callHeader: {
        title: "CamFallback · Demo",
        duration: "30 min",
        attendees: [{ name: "Harshveer", role: "Customer" }],
      },
    },
    analysisMeta: { callType: "demo", videoAvailable: true, pass2Debug: { route: "ffmpeg" } },
    videoFacts: {
      status: "ready",
      streamKind: "video",
      cameraOnPct: 82,
      attendeeCurveJson: [
        { name: "Sathish Kuttan", role: "Solution Engineer", talkPct: 70, cameraOn: null },
        { name: "Priyal", role: "Account Executive", talkPct: 5, cameraOn: null },
        { name: "Harshveer", role: "Customer", talkPct: 25, cameraOn: null },
      ],
    },
  },
);
const seCamFallbackContainer = { innerHTML: "" };
Object.defineProperty(seCamFallbackContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(seCamFallbackContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(seCamFallbackContainer, firebaseSession, { callId: seCamFallbackSaved.id });
assert(seCamFallbackContainer.innerHTML.includes("cam On"), "SE falls back to top-level cameraOnPct when curve lacks camera");
assert(seCamFallbackContainer.innerHTML.includes("82%"), "SE shows cameraOnPct from top-level videoFacts");

const transcriptOnlySaved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/transcript-only",
    confirmedIdentities: {
      seIdentity: "Sathish Kuttan",
      aeIdentity: "Priyal",
      customerIdentities: ["Harshveer"],
    },
  },
  {
    analysis: {
      callHeader: {
        title: "TranscriptOnly · Demo",
        duration: "30 min",
        attendees: [{ name: "Harshveer", role: "Customer" }],
      },
    },
    analysisMeta: { callType: "demo", videoAvailable: true, pass2Debug: { route: "transcript" } },
    videoFacts: {
      status: "ready",
      streamKind: "transcript_infer",
      attendeeCurveJson: [
        { name: "Sathish Kuttan", role: "Solution Engineer", talkPct: 70, cameraOn: null },
        { name: "Priyal", role: "Account Executive", talkPct: 5, cameraOn: null },
        { name: "Harshveer", role: "Customer", talkPct: 25, cameraOn: null },
      ],
    },
  },
);
const transcriptOnlyContainer = { innerHTML: "" };
Object.defineProperty(transcriptOnlyContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(transcriptOnlyContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(transcriptOnlyContainer, firebaseSession, { callId: transcriptOnlySaved.id });
assert(
  transcriptOnlyContainer.innerHTML.includes("Pass 2 used transcript only"),
  "shows pass2 hint when talk present but camera unknown on transcript path",
);

const ffmpegMissingSaved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/ffmpeg-missing",
    confirmedIdentities: {
      seIdentity: "Sathish Kuttan",
      customerIdentities: ["Harshveer"],
    },
  },
  {
    analysis: {
      callHeader: {
        title: "FfmpegMissing · Demo",
        duration: "30 min",
        attendees: [{ name: "Harshveer", role: "Customer" }],
      },
    },
    analysisMeta: {
      callType: "demo",
      videoAvailable: true,
      pass2Debug: { route: "transcript", ffmpegOk: false, hasRecordingUrl: true },
    },
    videoFacts: {
      status: "ready",
      streamKind: "transcript_infer",
      attendeeCurveJson: [
        { name: "Sathish Kuttan", role: "Solution Engineer", talkPct: 70, cameraOn: null },
        { name: "Harshveer", role: "Customer", talkPct: 30, cameraOn: null },
      ],
    },
  },
);
const ffmpegMissingContainer = { innerHTML: "" };
Object.defineProperty(ffmpegMissingContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(ffmpegMissingContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(ffmpegMissingContainer, firebaseSession, { callId: ffmpegMissingSaved.id });
assert(
  ffmpegMissingContainer.innerHTML.includes("videoPass.ffmpeg"),
  "shows VPS ffmpeg hint when recording present but ffmpeg unavailable",
);

const emmaSaved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/emma-merge",
    confirmedIdentities: {
      seIdentity: "Antony S.",
      customerIdentities: ["Emma Wark"],
    },
  },
  {
    analysis: {
      callHeader: {
        title: "Gamersheek · Demo",
        duration: "45 min",
        attendees: [
          { name: "Emma Wark", role: "Customer" },
          { name: "emma w", email: "emma.w@gamersheek.co.uk", role: "Customer" },
        ],
      },
    },
    analysisMeta: { callType: "demo" },
    videoFacts: {
      attendeeCurveJson: [
        { name: "Antony S.", role: "Solution Engineer", talkPct: 60, cameraOn: true },
        { name: "emma w", role: "Customer", talkPct: 40, cameraOn: true },
      ],
    },
  },
);
const emmaContainer = { innerHTML: "" };
Object.defineProperty(emmaContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(emmaContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(emmaContainer, firebaseSession, { callId: emmaSaved.id });
const emmaNameMatches = (emmaContainer.innerHTML.match(/Emma Wark/g) || []).length;
const emmaLowerMatches = (emmaContainer.innerHTML.match(/>\s*emma w\s*</gi) || []).length;
assert(emmaNameMatches >= 1, "shows merged Emma Wark name");
assert(emmaLowerMatches === 0, "does not show duplicate emma w row label");
const emmaStakeholderCards = (emmaContainer.innerHTML.match(/class="call-stakeholder-card(?: |")/g) || []).length;
assert(emmaStakeholderCards === 2, `room shows SE + one merged customer, got ${emmaStakeholderCards} cards`);

const junkCurveSaved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/junk-curve" },
  {
    analysis: {
      callHeader: { title: "Junk Curve · Demo", duration: "30 min", attendees: [{ name: "Pat", role: "Customer" }] },
    },
    scorecard: {
      callType: "demo",
      overall: 7.2,
      categoryScores: {
        discovery_qualification: 7,
        solution_technical_fit: 7,
        business_value: 7,
        credibility_objections: 7,
        communication_control: 7.2,
      },
      lines: [{
        themeKey: "call_flow",
        grade: 7.2,
        credit: 3,
        category: "communication_control",
        subParameters: [{ score: 2 }, { score: 2 }, { score: 1 }, { score: 1 }, { score: 1 }],
      }],
    },
    videoFacts: {
      attendeeCurveJson: {
        0: { name: "Pat", role: "Customer", talkPct: 40, cameraOn: true, cameraOnPct: 70 },
        junk: null,
      },
    },
  },
);
const junkCurveContainer = { innerHTML: "" };
Object.defineProperty(junkCurveContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(junkCurveContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(junkCurveContainer, firebaseSession, { callId: junkCurveSaved.id });
assert(!junkCurveContainer.innerHTML.includes("Could not load this call"), "malformed attendee curve must not break call record");
assert(junkCurveContainer.innerHTML.includes("qip-star-svg"), "star still renders with sanitized attendee curve");

const legacyLabelSaved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/legacy-label" },
  {
    analysis: {
      callHeader: { title: "Gamersheek · Demo", duration: "33 min", attendees: [{ name: "Emma", role: "Customer" }] },
    },
    scorecard: {
      callType: "Demo",
      rubricVersion: "1.0",
      overall: 0,
      lines: [{
        themeKey: "call_flow",
        grade: 0,
        credit: 3,
        category: "communication_control",
        subParameters: [{ score: 0 }, { score: 0 }, { score: 0 }, { score: 0 }, { score: 0 }],
      }],
    },
  },
);
const legacyLabelContainer = { innerHTML: "" };
Object.defineProperty(legacyLabelContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(legacyLabelContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(legacyLabelContainer, firebaseSession, { callId: legacyLabelSaved.id });
assert(!legacyLabelContainer.innerHTML.includes("Could not load this call"), "display-label callType (Demo) must not break call record");
assert(legacyLabelContainer.innerHTML.includes("Gamersheek"), "legacy label callType still shows call title");

const objectLinesSaved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/object-lines" },
  {
    analysis: { callHeader: { title: "Gamersheek · Demo", duration: "33 min" } },
    scorecard: {
      callType: "Demo",
      rubricVersion: "1.0",
      overall: 0,
      lines: {
        0: {
          themeKey: "call_flow",
          grade: 0,
          credit: 3,
          category: "communication_control",
          subParameters: [{ score: 0 }, { score: 0 }, { score: 0 }, { score: 0 }, { score: 0 }],
        },
      },
    },
  },
);
const objectLinesContainer = { innerHTML: "" };
Object.defineProperty(objectLinesContainer, "querySelector", { value: () => null, configurable: true });
Object.defineProperty(objectLinesContainer, "querySelectorAll", { value: () => [], configurable: true });
await renderCallView(objectLinesContainer, firebaseSession, { callId: objectLinesSaved.id });
assert(!objectLinesContainer.innerHTML.includes("Could not load this call"), "object-map scorecard lines must not break call record");

console.log("test-call-view: ok");
