import { parseTranscript } from "../transcript";
import { fetchRecordingFromShareLink, type ZoomShareResult } from "../zoomShare";
import { fetchZoomRecordingViaApi, type ZoomApiError } from "../zoom-api";
import { zoomApiConfigured, type ZoomEnv } from "../zoom";
import { fetchKaiaShareContent } from "../kaia/fetchShareContent";
import { isKaiaEngageShareUrl } from "../kaia/shareLink";
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
  VideoThemeApplicability,
} from "./types";

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

  let seIdentity =
    seTitled ||
    ownerSpeaker ||
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

export interface PostCallResolveOptions {
  /** Server-side Zoom credentials. When present, the account API is tried before scraping. */
  zoomEnv?: ZoomEnv;
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
  let transcript = input.transcript?.trim() || "";
  let meetingTitle = input.meetingTitle?.trim();
  let media: PostCallResolveResult["media"];
  let sourceKind: PostCallSourceKind = transcript ? "transcript" : "zoom";
  let videoAvailable = false;
  let callTime: string | undefined;
  let kaiaParticipantEmails: string[] = [];

  if (!transcript && input.recordingUrl?.trim()) {
    const url = input.recordingUrl.trim().split(/\s/)[0];
    if (isKaiaEngageShareUrl(url)) {
      sourceKind = "kaia";
      const fetched = await fetchKaiaShareContent(url);
      if (!fetched.ok) {
        throw Object.assign(new Error(fetched.message || "Could not fetch Kaia recording."), {
          status: fetched.reason === "not_found" ? 404 : 400,
        });
      }
      transcript = fetched.summary;
      if (!meetingTitle && fetched.title) meetingTitle = fetched.title;
      callTime = fetched.startTime;
      kaiaParticipantEmails = emailsFromKaiaParticipants(fetched.participants);
      // Kaia public share yields summary text, not Pass 2 video streams.
      videoAvailable = false;
    } else {
      sourceKind = "zoom";
      const fetched = await fetchZoomRecording(
        input.recordingUrl.trim(),
        input.recordingPassword?.trim(),
        options.zoomEnv,
      );
      transcript = fetched.transcript;
      media = fetched.media;
      if (!meetingTitle && fetched.topic) meetingTitle = fetched.topic;
      videoAvailable = !!(media?.streams?.length);
      // Only the API path knows the wall-clock start; the share scrape does not expose it.
      callTime = fetched.startTime;
    }
  }

  if (!transcript) {
    throw new Error("Provide a transcript or a Zoom/Kaia recording link.");
  }

  const parsed = parseTranscript(transcript);
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

  const identities = inferCallIdentities(
    parsed.speakers,
    participantEmails,
    input.ownerEmail,
    input.ownerDisplayName,
  );

  return {
    transcript,
    meetingTitle,
    sourceKind,
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
  };
}
