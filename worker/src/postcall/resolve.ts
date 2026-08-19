import { parseTranscript, parseTranscriptCues } from "../transcript";
import { fetchRecordingFromShareLink, type ZoomShareResult } from "../zoomShare";
import { fetchZoomRecordingViaApi, type ZoomApiError } from "../zoom-api";
import { zoomApiConfigured, type ZoomEnv } from "../zoom";
import { fetchKaiaShareContent } from "../kaia/fetchShareContent";
import { isKaiaEngageShareUrl } from "../kaia/shareLink";
import { extractAndMatchLinkedInIdentities } from "./linkedin-identity";
import {
  analysisConfidenceForVideo,
  QIP_PROFILES,
  VIDEO_THEME_NA_REASON,
} from "../rubric-profiles";
import {
  rankDealsOnAccount,
  resolveAccountMatch,
  suggestedCompanyName,
} from "./match";
import {
  corporateDomainsFromEmails,
  extractEmailsFromText,
  freeMailDomainsFromEmails,
  mergeParticipantEmails,
} from "./participants";
import type {
  PostCallResolveInput,
  PostCallResolveResult,
  PostCallSourceKind,
  TranscriptOrigin,
  VideoThemeApplicability,
} from "./types";
import type { VideoFactsDraft } from "../domain-model/video-facts";

export interface SummaryTimelineDraft {
  source: "summary";
  segments: Array<{
    startS: number;
    endS: number;
    segmentType: string;
    label?: string | null;
    source: "summary";
  }>;
  markers: [];
  hasTimestamps: boolean;
  durationSec: number | null;
}

/** Promote Pass 2 summary spine onto timeline.segments for Kaia / plain-summary calls. */
export function timelineDraftFromVideoFacts(
  videoFacts: VideoFactsDraft | null | undefined,
): SummaryTimelineDraft | null {
  const spine = videoFacts?.timelineSpine;
  if (!spine?.segments?.length) return null;
  return {
    source: "summary",
    segments: spine.segments.map((seg) => ({
      startS: seg.startS,
      endS: seg.endS,
      segmentType: seg.segmentType,
      label: seg.label ?? null,
      source: "summary" as const,
    })),
    markers: [],
    hasTimestamps: true,
    durationSec: spine.durationSec ?? videoFacts?.durationSec ?? null,
  };
}

/**
 * When Kaia summary is present and no video/transcript segments exist yet,
 * prefer the Pass 2 summary spine for display timeline.segments.
 */
export function mergeSummaryTimelineSegments(
  existingSegments: Array<{ source?: string }> | null | undefined,
  videoFacts: VideoFactsDraft | null | undefined,
): SummaryTimelineDraft | null {
  const hasVideo = (existingSegments || []).some((s) => (s.source || "video") === "video");
  const hasTranscript = (existingSegments || []).some((s) => s.source === "transcript");
  if (hasVideo || hasTranscript) return null;
  return timelineDraftFromVideoFacts(videoFacts);
}

function briefSnapshotsFromInput(input: PostCallResolveInput) {
  return (input.briefs || []).map((b) => ({
    ...b,
    prospectEmails: b.prospectEmails || [],
  }));
}

function videoThemesWhenUnavailable(videoAvailable: boolean): VideoThemeApplicability[] {
  if (videoAvailable) return [];
  const keys = new Set<string>();
  for (const profile of QIP_PROFILES) {
    for (const theme of profile.themes) {
      if (theme.requiresVideo) keys.add(theme.key);
    }
  }
  return [...keys].map((themeKey) => ({
    themeKey,
    applicable: false as const,
    reason: VIDEO_THEME_NA_REASON,
  }));
}

const INTERNAL_EMAIL_RE = /@(?:freshworks|freshdesk|freshservice)\./i;
const AE_TITLE_RE =
  /(?:^|[\s|,/(-])(ae|a\.e\.|account\s*exec(?:utive)?|account\s*manager|sales\s*rep|sdr|bdr)(?:$|[\s|,/)-])/i;
const SE_TITLE_RE =
  /(?:^|[\s|,/(-])(se|s\.e\.|solutions?\s*engineer|solutions?\s*consultant|sales\s*engineer|pre[- ]?sales)(?:$|[\s|,/)-])/i;

function looksLikeAe(label: string): boolean {
  const s = String(label || "");
  // Explicit AE pipe tags from Zoom ("Priyal | AE @Freshworks") always win.
  if (/\|\s*ae\b/i.test(s) || /\bae\s*@/i.test(s)) return true;
  return AE_TITLE_RE.test(s);
}

function looksLikeSe(label: string): boolean {
  const s = String(label || "");
  // "Priyal | AE @Freshworks" must not match via a bare "se" inside Freshworks.
  if (looksLikeAe(s)) return false;
  if (/\|\s*se\b/i.test(s)) return true;
  return SE_TITLE_RE.test(s);
}

function isInternalEmail(email: string): boolean {
  return INTERNAL_EMAIL_RE.test(email);
}

function isInternalLabel(label: string): boolean {
  return (
    looksLikeSe(label) ||
    looksLikeAe(label) ||
    /@freshworks\b|@freshdesk\b|@freshservice\b|\bfreshworks\b/i.test(label)
  );
}

function firstNameToken(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\|.*$/, "")
    .replace(/@.*$/, "")
    .split(/[\s,_-]+/)
    .find((t) => t.length >= 3 && !/^(mr|mrs|ms|dr)$/.test(t)) || "";
}

function labelMatchesOwner(label: string, ownerEmail?: string, ownerDisplayName?: string): boolean {
  const lower = label.trim().toLowerCase();
  if (!lower) return false;
  const email = ownerEmail?.trim().toLowerCase();
  if (email && (lower === email || lower.includes(email))) return true;
  const name = ownerDisplayName?.trim().toLowerCase();
  if (name && name.length >= 2) {
    const first = name.split(/\s+/)[0];
    if (lower === name || lower.startsWith(`${name} `) || lower.includes(` ${name}`)) return true;
    if (first && first.length >= 3 && (lower === first || lower.startsWith(`${first} `) || lower.includes(`| ${first}`))) {
      return true;
    }
  }
  return false;
}

function matchesCustomerHint(label: string, participantEmails: string[]): boolean {
  const token = firstNameToken(label);
  if (!token) return false;
  return participantEmails.some((email) => {
    if (isInternalEmail(email)) return false;
    const local = email.split("@")[0]?.toLowerCase() || "";
    return local === token || local.startsWith(token) || local.includes(token);
  });
}

function uniqueLabels(...groups: (string | undefined)[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const label = String(raw || "").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

export function inferCallIdentities(
  speakers: string[],
  participantEmails: string[],
  ownerEmail?: string,
  ownerDisplayName?: string,
  /** v2.3 — Kaia meeting-host display name, a strong (not certain) SE hint. See kaiaHostName(). */
  kaiaHost?: string,
): {
  seIdentity?: string;
  aeIdentity?: string;
  customerIdentities: string[];
  identityOptions: string[];
} {
  const identityOptions = uniqueLabels(
    ownerDisplayName ? [ownerDisplayName] : [],
    ownerEmail ? [ownerEmail] : [],
    speakers,
    participantEmails,
  );

  // Prefer people actually on the call over the logged-in session user (who may be a reviewer).
  const ownerSpeaker = speakers.find((s) => labelMatchesOwner(s, ownerEmail, ownerDisplayName));
  const seTitled = speakers.find((s) => looksLikeSe(s));
  const aeTitled = speakers.find((s) => looksLikeAe(s));
  const fwEmails = participantEmails.filter((e) => isInternalEmail(e));
  const nonAeSpeakers = speakers.filter((s) => !looksLikeAe(s));
  const fwSpeaker = nonAeSpeakers.find((s) => /freshworks|freshdesk|freshservice/i.test(s));

  // Never fall back to speakers[0] — that silently labels the AE as SE.
  const seColleague = speakers.find(
    (s) => !looksLikeAe(s) && !matchesCustomerHint(s, participantEmails),
  );
  const sessionFallback =
    (ownerDisplayName?.trim() && !looksLikeAe(ownerDisplayName) ? ownerDisplayName.trim() : undefined) ||
    (ownerEmail?.trim() || undefined);
  // Structural hint, not a title match — ranked below an explicit SE-titled speaker but
  // above the generic "any non-AE colleague" guess.
  const kaiaHostCandidate = kaiaHost && !looksLikeAe(kaiaHost) ? kaiaHost : undefined;

  let seIdentity =
    seTitled ||
    ownerSpeaker ||
    kaiaHostCandidate ||
    seColleague ||
    fwSpeaker ||
    fwEmails[0] ||
    sessionFallback ||
    undefined;
  // Hard guard — AE-titled labels are never SE, even if matching went sideways.
  if (seIdentity && looksLikeAe(seIdentity)) {
    seIdentity = seTitled || seColleague || fwSpeaker || sessionFallback || undefined;
  }

  const used = new Set(
    [seIdentity].filter(Boolean).map((s) => String(s).trim().toLowerCase()),
  );

  const aeIdentity =
    (aeTitled && !used.has(aeTitled.trim().toLowerCase()) ? aeTitled : undefined) ||
    speakers.find((s) => looksLikeAe(s) && !used.has(s.trim().toLowerCase())) ||
    fwEmails.find((e) => !used.has(e.trim().toLowerCase())) ||
    undefined;

  if (aeIdentity) used.add(aeIdentity.trim().toLowerCase());

  const customerSpeakers = speakers.filter(
    (s) =>
      !used.has(s.trim().toLowerCase()) &&
      !looksLikeAe(s) &&
      !looksLikeSe(s) &&
      (matchesCustomerHint(s, participantEmails) || !isInternalLabel(s)),
  );
  const customerEmails = participantEmails.filter((e) => {
    if (used.has(e.trim().toLowerCase()) || isInternalEmail(e)) return false;
    // Skip email when a speaker already covers the same person.
    return !customerSpeakers.some((s) => matchesCustomerHint(s, [e]));
  });
  const customerIdentities = uniqueLabels(customerSpeakers, customerEmails);

  return {
    seIdentity,
    aeIdentity,
    customerIdentities,
    identityOptions,
  };
}

function emailsFromKaiaParticipants(
  participants: { email?: string; displayName?: string }[] | undefined,
): string[] {
  if (!participants?.length) return [];
  return extractEmailsFromText(
    ...participants.map((p) => [p.email, p.displayName].filter(Boolean).join(" ")),
  );
}

/**
 * v2.3 (Agent 2) — Kaia hands over a clean roster of real names, but KaiaParticipantMeta
 * carries no email field, so emailsFromKaiaParticipants() (a regex over text that happens
 * to contain no "@") always returns [] for it — 100% of the roster was previously discarded.
 * This is the name-based counterpart: feeds identityOptions/customerIdentities so Kaia
 * participants show up as page-2 attendee candidates even when the transcript has none.
 */
function namesFromKaiaParticipants(
  participants: { displayName?: string }[] | undefined,
): string[] {
  if (!participants?.length) return [];
  return participants.map((p) => String(p?.displayName || "").trim()).filter(Boolean);
}

/** The Kaia meeting host is a strong (not certain) signal for who ran the call as SE. */
function kaiaHostName(
  participants: { displayName?: string; isHost?: boolean }[] | undefined,
): string | undefined {
  return participants?.find((p) => p?.isHost)?.displayName?.trim() || undefined;
}

export interface PostCallResolveOptions {
  /** Server-side Zoom credentials. When present, the account API is tried before scraping. */
  zoomEnv?: ZoomEnv;
  /**
   * LLM provider env for the speaker-attribution pass (see ./speaker-attribution). Optional —
   * when absent, `speakerAttribution` is simply omitted from the result (soft-skip, not a
   * failure). When present, a failure in the attribution call is also swallowed: resolve must
   * always succeed on transcript parsing / matching even if this best-effort pass errors.
   */
  providerEnv?: import("./speaker-attribution").Env;
  /**
   * v2.3 — only the interactive confirm-page flow (POST /api/postcall/resolve) ever shows the
   * speaker-attribution suggestion to a human and lets them act on it, so only that caller
   * should set this. The legacy/auto-pick path (runPostCallLegacyAnalyze) and the confirmed-
   * pipeline's defensive re-resolve both call runPostCallResolve without a human ever seeing
   * this result again, so leaving this unset there skips the LLM call entirely rather than
   * paying for a suggestion nobody will ever consume.
   */
  attributeSpeakers?: boolean;
}

/** Soft-fail wrapper — speaker attribution is a suggestion-only pass, never blocks resolve. */
async function trySpeakerAttribution(
  providerEnv: import("./speaker-attribution").Env | undefined,
  attributeSpeakers: boolean | undefined,
  transcript: string,
  participants: string[],
): Promise<import("./speaker-attribution").SpeakerAttributionResult | undefined> {
  if (!providerEnv) return undefined;
  if (!attributeSpeakers) return undefined; // not the confirm-page flow — nobody will see this suggestion
  if (!parseTranscriptCues(transcript).length) return undefined; // no timestamps → no room segments possible
  try {
    const { runPostCallSpeakerAttribution } = await import("./speaker-attribution");
    return await runPostCallSpeakerAttribution(providerEnv, { transcript, participants });
  } catch (err) {
    console.warn("[postcall/resolve] speaker attribution soft-fail:", (err as Error)?.message || err);
    return undefined;
  }
}

/**
 * Zoom account API first (works on accounts that force recaptcha on share links),
 * share-link scrape second. Only `fallback` errors continue to the scrape — a real
 * API failure (no transcript on the recording) is reported as-is.
 */
async function fetchZoomRecording(
  recordingUrl: string,
  recordingPassword: string | undefined,
  zoomEnv: ZoomEnv | undefined,
): Promise<ZoomShareResult & { startTime?: string }> {
  if (zoomEnv && zoomApiConfigured(zoomEnv)) {
    try {
      return await fetchZoomRecordingViaApi(zoomEnv, recordingUrl);
    } catch (err) {
      if (!(err as ZoomApiError).fallback) throw err;
    }
  }
  return fetchRecordingFromShareLink(recordingUrl, recordingPassword);
}

export async function runPostCallResolve(
  input: PostCallResolveInput,
  options: PostCallResolveOptions = {},
): Promise<PostCallResolveResult> {
  const pastedTranscript = input.transcript?.trim() || "";
  let meetingTitle = input.meetingTitle?.trim();
  let media: PostCallResolveResult["media"];
  let kaiaParticipantEmails: string[] = [];
  let kaiaParticipantNames: string[] = [];
  let kaiaHost: string | undefined;

  // v2.3 (Agent 1) — fetch every source the SE provided, independently, and keep them as
  // distinct fields. A Kaia link and a pasted/uploaded transcript are NOT alternatives: the
  // documented team process supplies both, and previously the `!transcript` guard below meant
  // the link was simply never fetched when a transcript was already present — Kaia's roster,
  // title, start time and summary were silently thrown away. Now both are always attempted.
  const sources: PostCallResolveResult["sources"] = {};

  if (input.recordingUrl?.trim()) {
    const url = input.recordingUrl.trim().split(/\s/)[0];
    if (isKaiaEngageShareUrl(url)) {
      try {
        const fetched = await fetchKaiaShareContent(url);
        if (!fetched.ok) {
          // A usable transcript exists from elsewhere — soft-fail, log and continue.
          if (!pastedTranscript) {
            throw Object.assign(new Error(fetched.message || "Could not fetch Kaia recording."), {
              status: fetched.reason === "not_found" ? 404 : 400,
            });
          }
          console.warn("[postcall/resolve] Kaia fetch soft-fail (transcript already supplied):", fetched.message);
        } else {
          sources.kaia = {
            summary: fetched.summary,
            summaryJson: fetched.summaryJson,
            participants: fetched.participants || [],
            title: fetched.title,
            startTime: fetched.startTime,
          };
          kaiaParticipantEmails = emailsFromKaiaParticipants(fetched.participants);
          kaiaParticipantNames = namesFromKaiaParticipants(fetched.participants);
          kaiaHost = kaiaHostName(fetched.participants);
          // Rare: some Kaia payloads carry an actual transcript excerpt, not just prose —
          // this can win the scoring transcript below like any other real transcript source.
          if (fetched.transcriptExcerpt?.trim() && !pastedTranscript) {
            sources.transcript = {
              text: fetched.transcriptExcerpt.trim(),
              origin: "kaia_api",
              hasTimestamps: parseTranscriptCues(fetched.transcriptExcerpt).length > 0,
              speakers: [],
            };
          }
        }
      } catch (err) {
        if (!pastedTranscript) throw err;
        console.warn(
          "[postcall/resolve] Kaia fetch soft-fail (transcript already supplied):",
          (err as Error)?.message || err,
        );
      }
    } else {
      try {
        const fetched = await fetchZoomRecording(
          input.recordingUrl.trim(),
          input.recordingPassword?.trim(),
          options.zoomEnv,
        );
        sources.zoom = {
          transcript: fetched.transcript,
          media: fetched.media,
          topic: fetched.topic,
          // Only the API path knows the wall-clock start; the share scrape does not expose it.
          startTime: fetched.startTime,
        };
        media = fetched.media;
      } catch (err) {
        if (!pastedTranscript) throw err;
        console.warn(
          "[postcall/resolve] Zoom fetch soft-fail (transcript already supplied):",
          (err as Error)?.message || err,
        );
      }
    }
  }

  // Precedence for the scoring transcript: a real speaker-tagged transcript ALWAYS wins over
  // a Kaia summary — pasted/uploaded (what the SE explicitly gave us) beats a fetched Zoom
  // transcript, which beats the rare Kaia transcript-excerpt path. A Kaia summary is NEVER
  // placed in `transcript`; when it's all we have, transcript is "" and summaryOnly is true.
  let transcript = "";
  let transcriptOrigin: TranscriptOrigin | undefined;
  if (pastedTranscript) {
    transcript = pastedTranscript;
    transcriptOrigin = input.transcriptOrigin === "uploaded" ? "uploaded" : "pasted";
  } else if (sources.zoom?.transcript) {
    transcript = sources.zoom.transcript;
    transcriptOrigin = "zoom";
  } else if (sources.transcript?.text) {
    transcript = sources.transcript.text;
    transcriptOrigin = sources.transcript.origin;
  }

  const summaryOnly = !transcript && !!sources.kaia;
  if (!transcript && !summaryOnly) {
    throw new Error("Provide a transcript or a Zoom/Kaia recording link.");
  }

  const videoAvailable = !!(sources.zoom?.media?.streams?.length);
  const sourceKind: PostCallSourceKind =
    transcriptOrigin === "zoom" ? "zoom" : transcriptOrigin === "kaia_api" || summaryOnly ? "kaia" : "transcript";

  // Metadata merge — prefer Kaia title/startTime when the transcript path has none. At most
  // one of sources.zoom/sources.kaia is ever populated (one recordingUrl, one link type), so
  // this always resolves to "whichever fetched source has it" without conflicting.
  if (!meetingTitle) meetingTitle = sources.zoom?.topic || sources.kaia?.title;
  const callTime = sources.zoom?.startTime || sources.kaia?.startTime;

  const parsed = transcript
    ? parseTranscript(transcript)
    : { text: "", format: "plain" as const, speakers: [] as string[], wordCount: 0, durationMinutes: null };

  if (transcript && transcriptOrigin) {
    sources.transcript = {
      text: transcript,
      origin: transcriptOrigin,
      hasTimestamps: parseTranscriptCues(transcript).length > 0,
      speakers: parsed.speakers,
    };
  }
  const sourcesUsed = [
    ...new Set(
      [sources.transcript?.origin, sources.kaia ? "kaia_api" : null, sources.zoom ? "zoom" : null].filter(
        (v): v is string => !!v,
      ),
    ),
  ];

  const participantEmails = mergeParticipantEmails(
    input.participantEmails,
    kaiaParticipantEmails,
    extractEmailsFromText(transcript, meetingTitle),
  );
  const participantDomains = corporateDomainsFromEmails(participantEmails);
  const freeMailDomains = freeMailDomainsFromEmails(participantEmails);
  const needsCompanyDomain =
    participantEmails.length > 0 &&
    participantDomains.length === 0 &&
    freeMailDomains.length > 0;

  const briefs = briefSnapshotsFromInput(input);
  const accounts = input.accounts || [];
  const deals = input.deals || [];

  const account = resolveAccountMatch(
    briefs,
    accounts,
    participantEmails,
    input.ownerId,
    meetingTitle,
  );

  let rankedDeals: PostCallResolveResult["deals"] = [];
  if (account) {
    rankedDeals = rankDealsOnAccount(
      account,
      deals,
      briefs,
      participantEmails,
      input.ownerId,
      meetingTitle,
    );
  }

  const durationMinutes =
    media?.durationSec != null && Number.isFinite(media.durationSec)
      ? Math.round((media.durationSec / 60) * 10) / 10
      : parsed.durationMinutes;

  const noMatch =
    account || participantEmails.length === 0
      ? null
      : {
          participantEmails,
          participantDomains,
          suggestedCompanyName:
            input.companyName?.trim() ||
            suggestedCompanyName(meetingTitle, participantEmails),
        };

  // v2.3 (Agent 2) — Kaia's roster feeds identity inference alongside transcript speakers, not
  // instead of them. `parsed.speakers` itself stays transcript-only (transcriptMeta and
  // sources.transcript.speakers must reflect only what the transcript actually contains);
  // this merged list is local to identity inference only.
  const speakersForIdentity = [...parsed.speakers, ...kaiaParticipantNames];

  const identities = inferCallIdentities(
    speakersForIdentity,
    participantEmails,
    input.ownerEmail,
    input.ownerDisplayName,
    kaiaHost,
  );

  const attributionParticipants = uniqueLabels(
    identities.identityOptions,
    speakersForIdentity,
    identities.seIdentity ? [identities.seIdentity] : [],
    identities.aeIdentity ? [identities.aeIdentity] : [],
    identities.customerIdentities,
  );
  const speakerAttribution = await trySpeakerAttribution(
    options.providerEnv,
    options.attributeSpeakers,
    transcript,
    attributionParticipants,
  );

  // v2.3 (Agent 3) — same confirm-page-only gate as speaker attribution: only the interactive
  // flow ever renders these suggestions, so the legacy/auto path skips the work entirely
  // (deterministic parsing is cheap, but the rare LLM fallback for an ambiguous export is not
  // worth paying for on a path that can never show the result to anyone).
  const linkedinIdentities =
    options.attributeSpeakers && input.linkedinProfileExports?.length && options.providerEnv
      ? await extractAndMatchLinkedInIdentities(
          options.providerEnv,
          input.linkedinProfileExports,
          attributionParticipants,
          { userId: input.ownerId },
        )
      : undefined;

  return {
    transcript,
    meetingTitle,
    sourceKind,
    sources,
    sourcesUsed,
    summaryOnly,
    videoAvailable,
    callTime,
    durationMinutes,
    seIdentity: identities.seIdentity,
    aeIdentity: identities.aeIdentity,
    customerIdentities: identities.customerIdentities,
    identityOptions: identities.identityOptions,
    participantEmails,
    participantDomains,
    freeMailDomains,
    needsCompanyDomain,
    videoThemesNotApplicable: videoThemesWhenUnavailable(videoAvailable),
    analysisConfidence: analysisConfidenceForVideo(videoAvailable),
    transcriptMeta: {
      format: parsed.format,
      speakerCount: parsed.speakers.length,
      wordCount: parsed.wordCount,
      durationMinutes: parsed.durationMinutes,
      speakers: parsed.speakers,
    },
    media,
    account,
    deals: rankedDeals,
    noMatch,
    speakerAttribution,
    linkedinIdentities,
  };
}
