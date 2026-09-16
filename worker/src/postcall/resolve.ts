import { parseTranscript, parseTranscriptCues } from "../transcript";
import { fetchRecordingFromShareLink, parseZoomShareUrl, type ZoomShareResult } from "../zoomShare";
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

function compactAlpha(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Mirrors web/identity-merge.js — tiny closed SE-call nickname list. */
const GIVEN_NAME_ALIASES: Record<string, string[]> = {
  matt: ["matthew"],
  matthew: ["matt"],
  mike: ["michael"],
  michael: ["mike"],
  dave: ["david"],
  david: ["dave"],
  dan: ["daniel"],
  daniel: ["dan"],
  chris: ["christopher"],
  christopher: ["chris"],
};

function givenNameVariants(first: string): string[] {
  const f = String(first || "")
    .trim()
    .toLowerCase();
  if (!f) return [];
  return [f, ...(GIVEN_NAME_ALIASES[f] || [])];
}

function emailLocalConcatenations(personName: string): Set<string> {
  const tokens = personName
    .trim()
    .toLowerCase()
    .replace(/\|.*$/, "")
    .replace(/@.*$/, "")
    .split(/[\s,_-]+/)
    .filter(Boolean);
  const out = new Set<string>();
  if (!tokens.length) return out;
  const last = tokens.length >= 2 ? tokens[tokens.length - 1] : "";
  for (const first of givenNameVariants(tokens[0] || "")) {
    out.add(first);
    if (last.length >= 3) {
      out.add(`${first}${last}`);
      out.add(`${first[0]}${last}`);
      if (first.length >= 3) out.add(`${first}${last[0]}`);
    }
  }
  return out;
}

/** Mirrors web/identity-merge.js emailLocalMatchesName. */
function emailLocalMatchesName(emailOrLocal: string, personName: string): boolean {
  const raw = String(emailOrLocal || "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  const local = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  const compact = compactAlpha(local);
  if (compact.length < 4) return false;
  if (emailLocalConcatenations(personName).has(compact)) return true;

  const localTokens = local.replace(/[._+\-]/g, " ").split(/\s+/).filter(Boolean);
  const nameTokens = personName
    .trim()
    .toLowerCase()
    .replace(/\|.*$/, "")
    .replace(/@.*$/, "")
    .split(/[\s,_-]+/)
    .filter(Boolean);
  if (nameTokens.length < 2 || localTokens.length < 2) return false;
  const last = nameTokens[nameTokens.length - 1] || "";
  if (last.length < 3) return false;
  const localFirst = compactAlpha(localTokens[0] || "");
  const localRest = compactAlpha(localTokens.slice(1).join(""));
  if (!localFirst || !localRest) return false;
  const firsts = givenNameVariants(nameTokens[0] || "");
  let firstOk = firsts.includes(localFirst);
  if (!firstOk) {
    for (const first of firsts) {
      const [shorter, longer] =
        first.length <= localFirst.length ? [first, localFirst] : [localFirst, first];
      if (shorter.length >= 4 && longer.startsWith(shorter)) {
        firstOk = true;
        break;
      }
    }
  }
  if (!firstOk) return false;
  return localRest === last || localRest === last[0] || last.startsWith(localRest);
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

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Conservative first-name similarity — mirrors web/identity-merge.js firstNamesSimilar. */
function firstNamesSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < 4) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 5 && longer.startsWith(shorter)) return true;
  const dist = levenshtein(a, b);
  if (dist === 1 && minLen >= 5) return true;
  if (minLen >= 5 && dist / maxLen <= 0.2) return true;
  return false;
}

function matchesCustomerHint(label: string, participantEmails: string[]): boolean {
  const token = firstNameToken(label);
  if (!token) return false;
  return participantEmails.some((email) => {
    if (isInternalEmail(email)) return false;
    const local = email.split("@")[0]?.toLowerCase() || "";
    if (!local) return false;
    if (local === token) return true;
    // Token-bounded prefix (matt.newman) — never mid-token ("se" in salasevicius).
    if (local.startsWith(`${token}.`) || local.startsWith(`${token}_`) || local.startsWith(`${token}-`)) {
      return true;
    }
    if (emailLocalMatchesName(email, label)) return true;
    const localFirst = local.split(/[._-]/)[0] || "";
    return firstNamesSimilar(token, localFirst);
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
 * Outcome counters per scenario, so the real Zoom failure distribution is
 * visible for the first time (astra-audit F-026, implementation prompt P13).
 * No metrics pipeline exists for this yet -- structured console.info lines,
 * matching the [tag] convention already used elsewhere in this codebase
 * (e.g. "[history]", "[dual-write]"), are the repo's existing telemetry.
 */
function classifyZoomFetchOutcome(err: unknown): string {
  const e = err as { status?: number; pending?: boolean; message?: string } | undefined;
  if (!e) return "ok";
  if (e.pending) return "transcript_pending";
  if (e.status === 404 && /no transcript/i.test(e.message || "")) return "transcript_absent";
  if (/startTime/i.test(e.message || "")) return "no_start_time";
  if (/CAPTCHA/i.test(e.message || "")) return "captcha";
  if (/Microsoft sign-in/i.test(e.message || "")) return "sso_redirect";
  if (e.status === 401 || e.status === 403) return "permission_denied";
  if (e.status === 504 || /timed out/i.test(e.message || "")) return "timeout";
  if (e.status === 404) return "no_match";
  return "error";
}

/**
 * Zoom account API first (works on accounts that force recaptcha on share links),
 * share-link scrape second. Only `fallback` errors continue to the scrape — a real
 * API failure (no transcript on the recording) is reported as-is.
 *
 * Freshworks Zoom links are NOT special-cased to require the API: only some
 * Freshworks recordings actually force a recaptcha on the share link, and
 * `zoomShare.ts`'s scrape path already detects that per-link (`needRecaptcha`
 * on share-info, or `captcha_error` from validate-meeting-passwd) and reports
 * the same OAuth-configuration hint at that point. A blanket domain check here
 * refused the scrape — which also carries the video streams, not just the
 * transcript — even on links that were never captcha-gated to begin with.
 */
async function fetchZoomRecording(
  recordingUrl: string,
  recordingPassword: string | undefined,
  zoomEnv: ZoomEnv | undefined,
  meetingTitle?: string,
): Promise<ZoomShareResult & { startTime?: string }> {
  let url = recordingUrl;
  let password = recordingPassword;
  try {
    const parsed = parseZoomShareUrl(recordingUrl);
    url = parsed.url.toString();
    password = recordingPassword || parsed.embeddedPasscode;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && status < 500) throw err;
  }
  if (zoomEnv && zoomApiConfigured(zoomEnv)) {
    try {
      // meetingTitle only matters when the link has no ?startTime= -- see
      // findRecordingByTopic (astra-audit F-026/E-104). A `pending` error
      // (transcript still generating) is NOT a `fallback` error and must not
      // fall through to the scrape below; this already holds by construction
      // since fetchZoomRecordingViaApi never sets `fallback` on a pending result.
      return await fetchZoomRecordingViaApi(zoomEnv, url, fetch, { meetingTitle });
    } catch (err) {
      if (!(err as ZoomApiError).fallback) throw err;
    }
  }
  return fetchRecordingFromShareLink(url, password);
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
          meetingTitle,
        );
        sources.zoom = {
          transcript: fetched.transcript,
          media: fetched.media,
          topic: fetched.topic,
          // Only the API path knows the wall-clock start; the share scrape does not expose it.
          startTime: fetched.startTime,
        };
        media = fetched.media;
        console.info("[zoom-telemetry] outcome=ok");
      } catch (err) {
        console.info(`[zoom-telemetry] outcome=${classifyZoomFetchOutcome(err)}`);
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
