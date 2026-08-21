/**
 * JSONB shape contracts — ADR-007 section 4 / Design C.
 *
 * post_call.analysis, post_call.detail, pre_call.research_brief and
 * pre_call.input_snapshot are versioned JSONB. Every write declares a shape
 * version (10_shape_version.sql adds the columns); this validator is the
 * enforcement point: unknown top-level keys for the declared version are
 * rejected BEFORE the write, so blobs cannot drift silently.
 *
 * Adding a field = bump the version and add a new entry below. Never widen a
 * shipped version in place — old readers key off it.
 */

export type JsonbShape = "post_call.analysis" | "post_call.detail" | "pre_call.research_brief" | "pre_call.input_snapshot";

/** Allowed top-level keys per shape per version. */
const SHAPES: Record<JsonbShape, Record<string, ReadonlySet<string>>> = {
  "post_call.analysis": {
    "1": new Set([
      "analysisVersion", "artifacts", "callHeader", "callNotes",
      "followUpTable", "momentum", "nextSteps", "rubricVersion", "signals",
      "summary", "callType", "meddpicc", "arrLines", "arrOverrides",
      "productGaps", "whatLanded", "objections", "commitments",
      "momDraft", "followUps", "dealSignals", "quality",
    ]),
  },
  "post_call.detail": {
    "1": new Set([
      "analysis", "analysisMeta", "arrCompute", "arrInputs", "classify",
      "confirmed", "framework", "pass6", "qualification", "resolve",
      "scorecard", "summarise", "tcDeltas", "technicalCommit", "timeline",
      "transcriptMeta",
      "transcript", "videoFacts", "timelineSegments", "timelineMarkers",
      "momDrafts", "followUps", "objections", "meddpiccDeltas", "tcDeltas",
      "dealSignals", "dealSummaries", "accountSummaries", "arrLines",
      "arrOverrides", "gcsUri",
    ]),
  },
  "pre_call.research_brief": {
    "1": new Set([
      "description", "about", "incumbent", "fitSnapshot", "facts",
      "signals", "supportJD", "likelyPains", "industryUseCases",
      "checklist", "companySizeAgents", "businessContext", "discoveryKit",
      "painCapabilityValue", "attendees", "prospects", "icpFit", "recentNews",
      "newsSources", "assets", "meddpiccHints", "demoGuidance", "demoThesis",
      "rivals", "fishContext",
      "accountOverview", "stakeholders", "hypotheses", "questions",
      "competitiveContext", "recentSignals", "talkTracks", "sources",
    ]),
  },
  "pre_call.input_snapshot": {
    "1": new Set([
      "companyName", "companyDomain", "prospectEmail", "prospectEmails",
      "prospectName", "additionalContext", "ae", "effort", "prepType",
      "forceRefresh", "cachedResearch", "confirmedFacts",
      "linkedinProfileExports", "contextAttachments", "confirmedProspectProfiles",
      "meetingZoomUrl", "meetingZoomPasscode", "kaiaMeetingUrl", "kaiaSummary",
      "kaiaContent", "lifecycleId", "userId", "callId",
      "accountId", "dealId", "contactIds", "meetingType", "notes",
      "requestedAt", "requestedBy",
    ]),
  },
};

export const CURRENT_SHAPE_VERSION: Record<JsonbShape, string> = {
  "post_call.analysis": "1",
  "post_call.detail": "1",
  "pre_call.research_brief": "1",
  "pre_call.input_snapshot": "1",
};

export class ShapeValidationError extends Error {
  constructor(
    public shape: JsonbShape,
    public version: string,
    public unknownKeys: string[],
  ) {
    super(
      `${shape} v${version}: unknown top-level keys: ${unknownKeys.join(", ")}. ` +
        `Bump the shape version (10_shape_version.sql + SHAPES registry) to add fields.`,
    );
    this.name = "ShapeValidationError";
  }
}

/**
 * Validate a JSONB payload against its declared shape version.
 * Returns the version to stamp on the row. Throws ShapeValidationError on
 * unknown keys or unsupported version. null payloads pass through.
 */
export function validateJsonbShape(
  shape: JsonbShape,
  payload: Record<string, unknown> | null | undefined,
  version?: string,
): string {
  const v = version || CURRENT_SHAPE_VERSION[shape];
  if (payload == null) return v;
  const known = SHAPES[shape]?.[v];
  if (!known) {
    throw new ShapeValidationError(shape, v, [`<unsupported version "${v}">`]);
  }
  const unknown = Object.keys(payload).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new ShapeValidationError(shape, v, unknown);
  }
  return v;
}
