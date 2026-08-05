import { WORKER_BASE_URL } from "./firebase-config.js";
import { isFirebaseAuthEnabled, getSession } from "./auth.js";
import { savePostCallHistory, getPostCallAnalysis, normalizeUserEmail } from "./history.js";
import {
  normalizeQipScorecard,
  coerceScorecardLines,
  coerceSubParameters,
  isThemeExcludedFromAggregate,
  lineGradeForDisplay,
  legacySubParametersFromLine,
} from "./shared/qip-scorecard-normalize.js";
export { normalizeQipScorecard } from "./shared/qip-scorecard-normalize.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { CATEGORY_KEYS, CATEGORY_LABELS, profileFor, QIP_RADAR_LABELS, RUBRIC_VERSION, effectiveRubricVersion } from "./rubric-profiles.js";
import { buildPostCallResolveContext, invalidatePostCallResolveContext, enrichResolveDealsForAccount } from "./postcall-resolve-context.js";
import { resolveContactsForEmails } from "./postcall-contact-resolve.js";
import { invalidateDealListCache } from "./deal-view.js";
import { sessionUserId } from "./domain/session.js";
import { domainFromEmail } from "./domain/types.js";
import { isFreeMailDomain } from "./domain/constants.js";
import {
  bindActionOnce,
  readFieldValue,
  readFieldValueAsync,
  setFieldValue,
  setButtonLoading,
  setFieldError,
  setFormFieldsDisabled,
  showInlineStatus,
  wirePrintToolbar,
  wireToolbarById,
} from "./crayons-ui.js";
import {
  clearLinkedInAttachments,
  initLinkedInPdfUpload,
  linkedinProfileExportsForPayload,
  linkedinProfileExportsForStorage,
} from "./prep-linkedin-pdf.js";
import {
  clearContextAttachments,
  contextAttachmentsForPayload,
  initContextFileUpload,
} from "./prep-context-files.js";
import { mergeContextAttachments } from "./prep-context-attachments.js";
import {
  showPrepGenOverlay,
  updatePrepGenOverlay,
  hidePrepGenOverlay,
  prepStepsToPct,
  isGenOverlayActive,
  POSTCALL_GEN_THEME,
} from "./prep-generation-overlay.js";
import { showPipelineProgress, hidePipelineProgress } from "./pipeline-progress.js";
import { esc, $, show, EMPTY_DISPLAY, namesEqual, titleCaseDisplayName } from "./shared.js";
import { renderAccountDealPreviewHtml } from "./account-deal-preview.js";
export { renderAccountDealPreviewHtml } from "./account-deal-preview.js";
import { companyNameFromEmail } from "./prep-domain.js";
export { companyNameFromEmail };
import { deriveCallTimeline } from "./domain/timeline-service.js";
import { formatDealTitlePreview, inferDealTypeFromTitle as inferDealTypeFromTitleDomain } from "./domain/deal-service.js";
import { STAGE_LABELS } from "./domain/types.js";
import { buildSearchIndex, searchContacts } from "./search-service.js?v=2.1.14";
import { ensureCustomerContact } from "./domain/contact-service.js";
import {
  dedupePersonLabels,
  mergeCallIdentities,
  normalizePersonKey,
  preferPersonLabel,
} from "./identity-merge.js";
import {
  barClass,
  scorePct,
  momentumClass,
  radarDimensionLabel,
  renderRadarLabelText,
} from "./chart-shared.js";
import { renderQipRadar } from "./qip-radar.js";
import { themeLabel } from "./theme-library.js";
import {
  isThemeScoreSuppressed,
  THEME_SCORE_SUPPRESSION_MESSAGE,
} from "./theme-score-suppression.js";
import {
  sanitizeUserFacingCopy,
  resolveThemeNaReason,
} from "./user-facing-copy.js";
import { canonicalCallType } from "./call-type-labels.js";
import { buildCoachOutput, coachTextForSubParameter, insightfulCoachTip, loadScoreOverrides } from "./coach/index.js";

const RESOLVE_URL = `${WORKER_BASE_URL}/api/postcall/resolve`;
const CLASSIFY_URL = `${WORKER_BASE_URL}/api/postcall/classify`;
const GENERATE_URL = `${WORKER_BASE_URL}/api/postcall/generate`;
const QUALIFY_URL = `${WORKER_BASE_URL}/api/postcall/qualify`;
const COMMIT_URL = `${WORKER_BASE_URL}/api/postcall/commit`;
const SUMMARISE_URL = `${WORKER_BASE_URL}/api/postcall/summarise`;
const ARR_INPUTS_URL = `${WORKER_BASE_URL}/api/postcall/arr-inputs`;
const ARR_COMPUTE_URL = `${WORKER_BASE_URL}/api/postcall/arr-compute`;
const GAPS_URL = `${WORKER_BASE_URL}/api/postcall/gaps`;
const VIDEO_PASS_URL = `${WORKER_BASE_URL}/api/video-pass`;

const CALL_TYPES = [
  "demo",
  "discovery",
  "technical_deep_dive",
  "reverse_demo",
  "use_case_discussion",
  "trial_setup",
  "troubleshooting",
  "qa_session",
];

const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
};

const VIDEO_THEME_LABELS = {
  camera_on: "Camera on",
  cde_build: "CDE build",
  call_flow: "Call flow",
  customer_engagement: "Customer engagement",
};

const CONFIRM_ROLE_SET = ["Customer", "Primary SE", "Secondary SE", "AE", "Partner"];
const CONFIRM_ROLE_TONE = {
  Customer: { bg: "#f4e7df", color: "#b0785b" },
  "Primary SE": { bg: "#e3efec", color: "#2f8a7b" },
  "Secondary SE": { bg: "#dbe8e6", color: "#37746e" },
  AE: { bg: "#f3ecda", color: "#a5883f" },
  Partner: { bg: "#ece8de", color: "#877b63" },
};

let linkedinParsing = false;
let contextParsing = false;
let generating = false;
let confirmGateAccountLookupTeardown = null;
/** @type {(() => void)[]} */
let confirmGateContactLookupTeardowns = [];
/** @type {object[]|null} */
let confirmGateAttendees = null;
let companyNameTouched = false;
let newDealTitleTouched = false;
let suppressCompanyTouch = false;
let pcResolvedAccount = null;
let pcCreateNewAccount = false;
/** @type {string|null} */
let pcSelectedDealId = null;
let pcCreateNewDeal = false;
/** @type {'new_business'|'expansion'} */
let pcNewDealType = "new_business";
/** @type {object[]} */
let pcLastAccountDeals = [];
/** Last SE-authored company name — survives preview re-renders at submit. */
let pcDraftAccountName = "";
/** Editable new-deal title on intake preview (prefilled from formatDealTitlePreview). */
let pcDraftNewDealTitle = "";
/** After + New deal, focus and select the title input once preview re-renders. */
let pcFocusNewDealInput = false;
/** @type {(() => void) | null} */
let intakeAccountLookupTeardown = null;

function companyMono(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function defaultNewDealTitle(accountName, dealType = pcNewDealType) {
  const displayName = titleCaseDisplayName(accountName) || String(accountName || "Account").trim() || "Account";
  return formatDealTitlePreview(displayName, dealType);
}

/** Intake deal choice (page 1) carried into confirm + save — payload wins after pipeline starts. */
function getIntakeDealSelection() {
  const payload = pipelineState?.payload;
  const createNewDeal = !!(pcCreateNewDeal || payload?.createNewDeal);
  const selectedDealId = createNewDeal
    ? null
    : pcSelectedDealId || payload?.dealId || null;
  const newDealTitle = (
    pcDraftNewDealTitle ||
    payload?.newDealTitle ||
    (createNewDeal && (pcDraftAccountName.trim() || payload?.companyName)
      ? defaultNewDealTitle(pcDraftAccountName.trim() || payload?.companyName)
      : "")
  ).trim();
  const newDealType =
    inferDealTypeFromTitle(newDealTitle) ||
    payload?.newDealType ||
    pcNewDealType;
  return { createNewDeal, selectedDealId, newDealTitle, newDealType };
}

/** Intake account choice — payload wins over worker resolve on confirm. */
function getIntakeAccountSelection() {
  const payload = pipelineState?.payload;
  const createNewAccount = !!(pcCreateNewAccount || payload?.createNewAccount);
  const accountId = createNewAccount
    ? null
    : pcResolvedAccount?.id || payload?.accountId || null;
  const accountName = (
    pcDraftAccountName ||
    payload?.companyName ||
    ""
  ).trim();
  return { createNewAccount, accountId, accountName };
}

/** Confirm gate account — never let stale worker resolve override intake. */
export function resolveConfirmAccount(resolve) {
  const intake = getIntakeAccountSelection();
  if (intake.createNewAccount) {
    const name =
      intake.accountName ||
      pipelineState?.payload?.companyName ||
      resolve?.noMatch?.suggestedCompanyName ||
      "";
    return name
      ? { accountName: titleCaseDisplayName(name) || name, fromIntake: true }
      : null;
  }
  if (intake.accountId) {
    if (resolve?.account?.accountId === intake.accountId) return resolve.account;
    const name =
      intake.accountName ||
      pcResolvedAccount?.name ||
      resolve?.account?.accountName ||
      "Account";
    return {
      accountId: intake.accountId,
      accountName: name,
      fromIntake: true,
      reasons: [{ rank: "✓", detail: "Selected at intake" }],
    };
  }
  if (resolve?.account) return resolve.account;
  if (pcResolvedAccount?.id && !pcCreateNewAccount) {
    return {
      accountId: pcResolvedAccount.id,
      accountName: pcResolvedAccount.name,
      fromIntake: true,
    };
  }
  const fallbackName =
    intake.accountName ||
    pipelineState?.payload?.companyName ||
    resolve?.noMatch?.suggestedCompanyName;
  if (fallbackName) {
    return { accountName: titleCaseDisplayName(fallbackName) || fallbackName, fromIntake: true };
  }
  return null;
}

function resolveConfirmSelectedDeal(deals = []) {
  const intakeAccount = getIntakeAccountSelection();
  const { createNewDeal, selectedDealId, newDealTitle } = getIntakeDealSelection();
  if (intakeAccount.createNewAccount || createNewDeal) return null;
  if (selectedDealId) {
    const fromResolve = deals.find((d) => d.dealId === selectedDealId);
    if (fromResolve) return fromResolve;
    const fromIntake = pcLastAccountDeals.find((d) => d.id === selectedDealId);
    return {
      dealId: selectedDealId,
      title: fromIntake?.title || newDealTitle || "Selected deal",
      stage: fromIntake?.stage,
    };
  }
  return deals.find((d) => d.preselected) || deals[0] || null;
}

function syncNewDealTitlePrefill(accountName) {
  if (!newDealTitleTouched) {
    pcDraftNewDealTitle = defaultNewDealTitle(accountName);
    pcNewDealType = inferDealTypeFromTitle(pcDraftNewDealTitle);
  }
}

export function inferDealTypeFromTitle(title) {
  return inferDealTypeFromTitleDomain(title);
}

async function readAccountNameValue() {
  const raw = pcDraftAccountName.trim();
  return titleCaseDisplayName(raw) || raw;
}

function writeAccountName(name, { touch = false, titleCaseOnWrite = false } = {}) {
  let trimmed = String(name || "").trim();
  if (titleCaseOnWrite) trimmed = titleCaseDisplayName(trimmed) || trimmed;
  pcDraftAccountName = trimmed;
  if (touch) companyNameTouched = true;
  syncNewDealTitlePrefill(trimmed);
}
let companyPrefillTimer = null;
let crmMatchesTimer = null;
let crmMatchesToken = 0;
/** @type {null | { byEmail: object[] }} */
let lastCrmMatchResult = null;

/** @type {null | { payload: object, resolve: object|null, classify: object|null, generated: boolean, recordId: string|null }} */
let pipelineState = null;

let currentSession = null;
let getAuthToken = null;

function postCallResolveOpts() {
  const teamId = currentSession?.teamId;
  const ownerId = currentSession?.userId || currentSession?.uid || null;
  /** @type {{ teamId?: string, ownerId?: string }} */
  const opts = {};
  if (teamId) opts.teamId = teamId;
  if (ownerId && !String(ownerId).startsWith("usr_dummy_")) opts.ownerId = ownerId;
  return opts;
}

/** Sync stale usr_dummy_* Firebase sessions before owner-scoped Firestore reads. */
async function ensurePostCallSession() {
  if (!currentSession) return null;
  const raw = sessionUserId(currentSession);
  const needsResolve =
    isFirebaseAuthEnabled() &&
    currentSession.authUid &&
    raw?.startsWith("usr_dummy_");
  if (needsResolve) {
    const { syncSessionWithDomainStore } = await import("./auth.js");
    const synced = (await syncSessionWithDomainStore(currentSession)) || currentSession;
    currentSession = synced?.email
      ? { ...synced, email: String(synced.email).trim().toLowerCase() }
      : synced;
  }
  return currentSession;
}

/** Resolved domain owner id (authIndex over placeholder usr_dummy_*). */
async function postCallOwnerId() {
  await ensurePostCallSession();
  const { resolveEffectiveOwnerId } = await import("./domain/seed-dev.js");
  return resolveEffectiveOwnerId(currentSession);
}

const isUnknown = (v) => {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "unknown") return true;
  return s === "-" || s === "—" || s === "–";
};
const dash = (v) => (isUnknown(v) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(v));

export { normalizePersonKey, dedupePersonLabels, preferPersonLabel, mergeCallIdentities };

function truncateWords(text, max) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return esc(words.join(" "));
  return `${esc(words.slice(0, max).join(" "))}<span class="trunc-ellipsis">…</span>`;
}

/** Plain-text truncation for insight bullets (no HTML — those get escaped on render). */
function truncateWordsPlain(text, max) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  if (isFirebaseAuthEnabled() && getAuthToken) {
    const token = await getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Shared worker auth for deal ARR live recompute and other modules. */
export async function getWorkerAuthHeaders() {
  return authHeaders();
}

/** Parse "https://…/rec/share/… Passcode: abc" from one paste field. */
/** Zoom `?pwd=` query (API play passcode). NOT the `.token` path suffix. */
function extractZoomQueryPasscode(rawUrl) {
  try {
    const href = String(rawUrl || "").trim().split(/\s/)[0];
    if (!href) return undefined;
    const u = new URL(href);
    return u.searchParams.get("pwd")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseRecordingInput(rawUrl, rawPwd) {
  let url = String(rawUrl || "").trim();
  let password = String(rawPwd || "").trim();

  const passMatch = url.match(/\s+passcode\s*:\s*(.+)$/i);
  if (passMatch) {
    url = url.slice(0, passMatch.index).trim();
    if (!password) password = passMatch[1].trim();
  }

  // Do NOT treat `/share/id.token` as the meeting passcode — that trips Zoom CAPTCHA.
  if (!password) {
    const q = extractZoomQueryPasscode(url);
    if (q) password = q;
  }

  return { recordingUrl: url, recordingPassword: password || undefined };
}

function recordingHasExplicitPasscode(rawUrl, rawPwd) {
  if (String(rawPwd || "").trim()) return true;
  const raw = String(rawUrl || "");
  if (/\bpasscode\s*:/i.test(raw)) return true;
  return !!extractZoomQueryPasscode(raw);
}

function isKaiaRecordingUrl(url) {
  try {
    const u = new URL(String(url || "").trim().split(/\s/)[0]);
    return u.hostname.toLowerCase() === "engage.freshworks.com";
  } catch {
    return false;
  }
}

function isZoomRecordingUrl(url) {
  try {
    const host = new URL(String(url || "").trim().split(/\s/)[0]).hostname.toLowerCase();
    return host === "zoom.us" || host.endsWith(".zoom.us") || host === "zoomgov.com" || host.endsWith(".zoomgov.com");
  } catch {
    return false;
  }
}

/** Hidden by default. Only ask for a passcode when the pasted Zoom link has none. */
function syncPasscodeVisibility() {
  const wrap = $("pc-passcode-wrap");
  if (!wrap) return;
  const raw = readFieldValue($("pc-recording-url"));
  const { recordingUrl } = parseRecordingInput(raw, "");
  const needsPwd =
    !!recordingUrl &&
    isZoomRecordingUrl(recordingUrl) &&
    !isKaiaRecordingUrl(recordingUrl) &&
    !recordingHasExplicitPasscode(raw, readFieldValue($("pc-recording-pwd")));
  wrap.hidden = !needsPwd;
}

const TRANSCRIPT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Load a transcript file into the paste box. VTT/SRT cue markup is left intact —
 * the worker's parseTranscript understands both.
 */
export async function readTranscriptFile(file) {
  if (!file) return { ok: false, error: "No file selected." };
  if (file.size > TRANSCRIPT_FILE_MAX_BYTES) {
    return { ok: false, error: "That file is over 5 MB. Transcripts are text; check the file." };
  }
  if (!/\.(vtt|srt|txt)$/i.test(file.name || "")) {
    return { ok: false, error: "Use the .vtt transcript from Zoom (or a .txt / .srt)." };
  }
  let text = "";
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  if (!text.trim()) return { ok: false, error: "That file is empty." };
  return { ok: true, text };
}

async function handleTranscriptFileChange(event) {
  const input = event?.target;
  const nameEl = $("pc-transcript-file-name");
  const errorEl = $("pc-transcript-file-error");
  const textarea = $("pc-transcript");
  const file = input?.files?.[0];

  if (nameEl) nameEl.hidden = true;
  if (errorEl) errorEl.hidden = true;

  const result = await readTranscriptFile(file);
  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error;
      errorEl.hidden = false;
    }
    if (input) input.value = "";
    return;
  }

  if (textarea) textarea.value = result.text;
  if (nameEl) {
    const kb = Math.max(1, Math.round(file.size / 1024));
    nameEl.textContent = `${file.name} loaded (${kb} KB)`;
    nameEl.hidden = false;
  }
  if (input) input.value = "";
}

function parseProspectEmails(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function scheduleCompanyPrefill() {
  window.clearTimeout(companyPrefillTimer);
  companyPrefillTimer = window.setTimeout(() => { void prefillCompanyFromEmails(); }, 300);
  scheduleCrmMatches();
}

function scheduleCrmMatches() {
  window.clearTimeout(crmMatchesTimer);
  crmMatchesTimer = window.setTimeout(() => { void renderCrmMatchesPanel(); }, 350);
}

/** Show the per-email CRM panel only when tiles alone are not enough to act. */
export function shouldShowCrmMatchesPanel(result, resolvedAccount = pcResolvedAccount) {
  const matchedEntries = result.byEmail.filter((e) => e.matched);
  if (!matchedEntries.length) return false;
  if (resolvedAccount?.id) return false;
  if (result.accounts.length > 1) return true;
  if (matchedEntries.some((e) => e.accounts.length > 1)) return true;
  return false;
}

/** @param {object[]} accounts @param {string} name */
function findAccountByName(accounts, name) {
  if (!name) return null;
  return accounts.find((a) => namesEqual(a.name, name)) || null;
}

/** True when a previously picked account is still among CRM matches for typed emails. */
export function isResolvedAccountValidForResult(resolvedAccount, result) {
  if (!resolvedAccount?.id) return false;
  return (result.accounts || []).some((a) => a.id === resolvedAccount.id);
}

/** Drop stale account/deal picks that no longer match the current CRM lookup. */
export function reconcileIntakeStateWithCrmResult(result) {
  const prevAccountId = pcResolvedAccount?.id || null;
  if (pcResolvedAccount?.id && !isResolvedAccountValidForResult(pcResolvedAccount, result)) {
    pcResolvedAccount = null;
    pcCreateNewAccount = false;
    pcSelectedDealId = null;
    pcCreateNewDeal = false;
  }
  return prevAccountId;
}

/** Resolve which account the intake preview should reflect. */
export function resolveIntakeAccount(result, typedCompany, resolvedAccount = pcResolvedAccount) {
  if (resolvedAccount?.id && isResolvedAccountValidForResult(resolvedAccount, result)) {
    return resolvedAccount;
  }
  if (result.accounts.length === 1) {
    const a = result.accounts[0];
    return { id: a.id, name: a.name, domain: a.domain || null };
  }
  const byName = findAccountByName(result.accounts, typedCompany);
  if (byName) {
    return { id: byName.id, name: byName.name, domain: byName.domain || null };
  }
  return null;
}

/** Keep deal pick state aligned with deals on the active account. */
export function syncIntakeDealSelection(deals, state = {}) {
  const createNewDeal = state.createNewDeal ?? pcCreateNewDeal;
  const selectedDealId = state.selectedDealId ?? pcSelectedDealId;
  pcLastAccountDeals = deals;

  if (createNewDeal) {
    pcCreateNewDeal = true;
    pcSelectedDealId = null;
    if (!pcDraftNewDealTitle.trim()) {
      const accountName =
        pcDraftAccountName.trim() ||
        pipelineState?.payload?.companyName ||
        "";
      if (accountName) syncNewDealTitlePrefill(accountName);
    }
    return;
  }
  if (!deals.length) {
    pcSelectedDealId = null;
    pcCreateNewDeal = !!pcCreateNewAccount;
    if (pcCreateNewDeal && !pcDraftNewDealTitle.trim()) {
      const accountName =
        pcDraftAccountName.trim() ||
        pipelineState?.payload?.companyName ||
        "";
      if (accountName) syncNewDealTitlePrefill(accountName);
    }
    return;
  }
  if (selectedDealId && deals.some((d) => d.id === selectedDealId)) {
    pcSelectedDealId = selectedDealId;
    pcCreateNewDeal = false;
    return;
  }
  pcSelectedDealId = deals[0].id;
  pcCreateNewDeal = false;
}

function dealsForAccount(result, accountId) {
  if (!accountId) return [];
  return (result.deals || []).filter((d) => d.accountId === accountId);
}

/**
 * Account + deal preview grid for post-call intake page 1.
 * @param {{
 *   accountName: string,
 *   accountMatched: boolean,
 *   deals?: object[],
 *   selectedDealId?: string|null,
 *   createNewDeal?: boolean,
 *   newDealType?: 'new_business'|'expansion',
 *   newDealTitle?: string,
 * }} opts
 */
function renderPostcallAccountDealPreviewHtml(opts) {
  return renderAccountDealPreviewHtml({ ...opts, editableAccount: true });
}

function focusAndSelectNewDealInput(previewEl) {
  const input = previewEl?.querySelector?.('[data-action="edit-new-deal-title"]');
  if (!input) return;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/** Enter new-deal pick mode: deselect existing deal tiles and optionally focus the title field. */
function activateNewDealMode(previewEl, { focusInput = false } = {}) {
  const changed = !pcCreateNewDeal || pcSelectedDealId !== null;
  pcCreateNewDeal = true;
  pcSelectedDealId = null;
  if (focusInput) pcFocusNewDealInput = true;
  if (changed) {
    void renderCrmMatchesPanel();
  } else if (focusInput && previewEl) {
    focusAndSelectNewDealInput(previewEl);
  }
}

function wireAccountDealPreview(previewEl) {
  if (!previewEl) return;

  intakeAccountLookupTeardown?.();
  intakeAccountLookupTeardown = null;

  previewEl.querySelectorAll('[data-action="pick-deal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      pcSelectedDealId = btn.dataset.dealId || null;
      pcCreateNewDeal = false;
      pcFocusNewDealInput = false;
      void renderCrmMatchesPanel();
    });
  });
  previewEl.querySelectorAll('[data-action="pick-new-deal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      syncNewDealTitlePrefill(pcDraftAccountName);
      activateNewDealMode(previewEl, { focusInput: true });
    });
  });

  const accountInput = previewEl.querySelector('[data-action="edit-account-name"]');
  const accountSuggest = previewEl.querySelector(".pc-account-suggest");
  if (accountInput) {
    accountInput.addEventListener("input", () => {
      if (!suppressCompanyTouch) companyNameTouched = true;
      pcDraftAccountName = accountInput.value;
      syncNewDealTitlePrefill(pcDraftAccountName);
    });
    accountInput.addEventListener("blur", () => {
      const cased = titleCaseDisplayName(accountInput.value.trim()) || accountInput.value.trim();
      if (cased && cased !== accountInput.value) {
        suppressCompanyTouch = true;
        accountInput.value = cased;
        pcDraftAccountName = cased;
        suppressCompanyTouch = false;
      }
      const err = $("pc-account-name-error");
      if (err && cased) {
        err.hidden = true;
        err.textContent = "";
      }
      void renderCrmMatchesPanel();
    });
    if (accountSuggest) {
      intakeAccountLookupTeardown = attachAccountLookup({
        inputEl: accountInput,
        menuEl: accountSuggest,
        onPick: (account, typedName) => {
          writeAccountName(typedName, { touch: true, titleCaseOnWrite: true });
          if (!account) {
            pcCreateNewAccount = true;
            pcResolvedAccount = null;
            pcSelectedDealId = null;
            pcCreateNewDeal = true;
          } else {
            pcCreateNewDeal = false;
            pcSelectedDealId = null;
          }
          scheduleCrmMatches();
        },
      }) || null;
    }
  }

  previewEl.querySelectorAll('[data-action="edit-new-deal-title"]').forEach((input) => {
    input.addEventListener("focus", () => {
      if (!pcCreateNewDeal || pcSelectedDealId !== null) {
        activateNewDealMode(previewEl, { focusInput: true });
      }
    });
    input.addEventListener("click", () => {
      if (pcCreateNewDeal) input.select();
    });
    input.addEventListener("input", () => {
      if (!pcCreateNewDeal || pcSelectedDealId !== null) {
        pcCreateNewDeal = true;
        pcSelectedDealId = null;
      }
      newDealTitleTouched = true;
      pcDraftNewDealTitle = input.value;
      pcNewDealType = inferDealTypeFromTitle(input.value);
    });
    input.addEventListener("blur", () => {
      const trimmed = input.value.trim();
      if (trimmed) {
        pcDraftNewDealTitle = trimmed;
        pcNewDealType = inferDealTypeFromTitle(trimmed);
      }
    });
  });
}

/**
 * Contact-primary surfacing: for every typed email, show which existing Account(s)
 * and Deal(s) already exist in the CRM, or that a new account will be created.
 * Clicking a matched account selects it for the confirm gate.
 */
async function renderCrmMatchesPanel() {
  const panel = $("pc-crm-matches");
  const preview = $("pc-account-deal-preview");
  if (!panel) return;
  const emails = await getProspectEmailsFromField();
  const typedCompany = await readAccountNameValue();
  if (!emails.length) {
    panel.hidden = true;
    panel.innerHTML = "";
    if (preview) preview.hidden = true;
    return;
  }

  const token = ++crmMatchesToken;
  let result;
  try {
    result = await resolveContactsForEmails(emails);
  } catch (err) {
    console.warn("[postcall] CRM match lookup failed:", err?.message || err);
    panel.hidden = true;
    if (preview) preview.hidden = true;
    return;
  }
  if (token !== crmMatchesToken) return;
  lastCrmMatchResult = result;

  const matchedCount = result.byEmail.filter((e) => e.matched).length;
  const prevAccountId = reconcileIntakeStateWithCrmResult(result);
  const derivedFromEmail =
    titleCaseDisplayName(companyNameFromEmail(emails[0])) || companyNameFromEmail(emails[0]) || "";
  const resolved = resolveIntakeAccount(result, typedCompany);
  if (resolved?.id && !pcResolvedAccount?.id) {
    pcResolvedAccount = resolved;
    pcCreateNewAccount = false;
    pcCreateNewDeal = false;
    pcSelectedDealId = null;
  } else if (
    !resolved?.id &&
    typedCompany &&
    !pcResolvedAccount?.id &&
    !findAccountByName(result.accounts, typedCompany)
  ) {
    pcCreateNewAccount = true;
    pcCreateNewDeal = true;
  }

  const accountMatched = !!(pcResolvedAccount?.id || resolved?.id);
  const activeAccount = pcResolvedAccount || resolved;
  const newAccountId = activeAccount?.id || null;
  if (prevAccountId !== newAccountId) {
    pcSelectedDealId = null;
    pcCreateNewDeal = false;
    newDealTitleTouched = false;
  }

  const accountDeals = dealsForAccount(result, activeAccount?.id);
  syncIntakeDealSelection(accountDeals, {
    createNewDeal: pcCreateNewDeal,
    selectedDealId: pcSelectedDealId,
  });

  const accountName =
    activeAccount?.name ||
    derivedFromEmail ||
    typedCompany ||
    result.accounts[0]?.name ||
    "New account";

  if (!accountMatched && derivedFromEmail && !companyNameTouched) {
    writeAccountName(derivedFromEmail, { titleCaseOnWrite: true });
  }

  syncNewDealTitlePrefill(accountName);

  if (preview) {
    preview.hidden = false;
    preview.innerHTML = renderPostcallAccountDealPreviewHtml({
      accountName,
      accountMatched,
      deals: pcLastAccountDeals,
      selectedDealId: pcSelectedDealId,
      createNewDeal: pcCreateNewDeal,
      newDealType: pcNewDealType,
      newDealTitle: pcDraftNewDealTitle,
    });
    wireAccountDealPreview(preview);
    if (pcFocusNewDealInput && pcCreateNewDeal) {
      pcFocusNewDealInput = false;
      focusAndSelectNewDealInput(preview);
    }
  }

  if (!shouldShowCrmMatchesPanel(result)) {
    panel.hidden = true;
    panel.innerHTML = "";
  } else {
    const rows = result.byEmail
      .filter((entry) => entry.matched)
      .map((entry) => {
        const accountChips = entry.accounts
          .map((a) => {
            const dealsForAccountRow = entry.deals.filter((d) => d.accountId === a.id);
            const dealBits = dealsForAccountRow.length
              ? dealsForAccountRow
                  .map(
                    (d) =>
                      `<span class="pc-crm-deal" title="${esc(d.stage || "")} · ${esc(d.status || "")}">${esc(titleCaseDisplayName(d.title || "Deal"))}</span>`,
                  )
                  .join("")
              : `<span class="pc-crm-deal pc-crm-deal--none">no deal yet</span>`;
            return `<button type="button" class="pc-crm-account" data-action="pick-crm-account" data-account-id="${esc(a.id)}" data-account-name="${esc(a.name || "")}" data-account-domain="${esc(a.domain || "")}">
                <span class="pc-crm-account-name">${esc(titleCaseDisplayName(a.name || a.domain || "Account"))}</span>
                <span class="pc-crm-deals">${dealBits}</span>
              </button>`;
          })
          .join("");

        return `<div class="pc-crm-row">
            <span class="pc-crm-email">${esc(entry.email)}</span>
            <span class="pc-crm-matchset">${accountChips}</span>
          </div>`;
      })
      .join("");

    const header = `Found in CRM — ${result.accounts.length} account${result.accounts.length === 1 ? "" : "s"}, ${result.deals.length} deal${result.deals.length === 1 ? "" : "s"}`;
    panel.innerHTML = `<div class="pc-crm-head">${esc(header)}</div>${rows}`;
    panel.hidden = false;
  }

  if (!matchedCount && typedCompany && !pcResolvedAccount?.id) {
    pcCreateNewAccount = true;
  }

  wireCrmMatchesPanel(panel, result);
}

function wireCrmMatchesPanel(panel, result) {
  panel.querySelectorAll('[data-action="pick-crm-account"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const accountId = btn.dataset.accountId;
      const account = result.accounts.find((a) => a.id === accountId);
      if (!account) return;
      pcResolvedAccount = {
        id: account.id,
        name: account.name,
        domain: account.domain || null,
      };
      pcCreateNewAccount = false;
      pcCreateNewDeal = false;
      pcSelectedDealId = null;
      void writeAccountName(account.name || "", { touch: true, titleCaseOnWrite: true });
      panel.querySelectorAll(".pc-crm-account").forEach((el) => el.classList.remove("pc-crm-account--selected"));
      btn.classList.add("pc-crm-account--selected");
      void renderCrmMatchesPanel();
    });
  });
}

/** ISO yyyy-mm-dd for the actual recording, falling back to today. */
function meetingDateFromResolve(resolve) {
  const raw = resolve?.callTime || resolve?.media?.startTime || null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function tryMatchEmail(ctx, email) {
  const domain = domainFromEmail(email);
  if (!domain) return null;
  const account = (ctx.accounts || []).find(
    (a) => String(a.domain || "").toLowerCase() === domain,
  );
  if (account?.name) {
    return { name: account.name, account };
  }
  const derived = companyNameFromEmail(email);
  if (derived) {
    const byName = (ctx.accounts || []).find((a) => namesEqual(a.name, derived));
    if (byName?.name) return { name: byName.name, account: byName };
  }
  const brief = (ctx.briefs || []).find((b) =>
    (b.prospectEmails || []).some((e) => e === email) ||
    String(b.domain || "").toLowerCase() === domain ||
    (derived && namesEqual(b.meta?.company || b.companyName, derived)),
  );
  if (brief?.companyName) {
    return { name: brief.companyName, account: null };
  }
  return null;
}

async function prefillCompanyFromEmails() {
  if (companyNameTouched) return;

  const emails = await getProspectEmailsFromField();
  if (!emails.length) {
    if (pcResolvedAccount) {
      pcResolvedAccount = null;
      pcSelectedDealId = null;
      pcCreateNewDeal = false;
    }
    return;
  }

  if (pcResolvedAccount?.id) {
    try {
      const check = await resolveContactsForEmails(emails);
      if (!isResolvedAccountValidForResult(pcResolvedAccount, check)) {
        pcResolvedAccount = null;
        pcSelectedDealId = null;
        pcCreateNewDeal = false;
        pcDraftAccountName = "";
      }
    } catch {
      /* best-effort */
    }
  }

  if (
    pcDraftAccountName.trim() &&
    pcResolvedAccount &&
    namesEqual(pcDraftAccountName, pcResolvedAccount.name)
  ) {
    return;
  }
  if (pcDraftAccountName.trim() && !pcResolvedAccount) {
    pcDraftAccountName = "";
  }

  const ownerId = await postCallOwnerId();
  if (!ownerId) return;
  try {
    const ctx = await buildPostCallResolveContext(ownerId, postCallResolveOpts());
    const primary = emails[0];
    let match = await tryMatchEmail(ctx, primary);
    if (!match) {
      for (const email of emails.slice(1)) {
        match = await tryMatchEmail(ctx, email);
        if (match) break;
      }
    }
    if (match) {
      writeAccountName(match.name, { titleCaseOnWrite: true });
      if (match.account) {
        pcResolvedAccount = {
          id: match.account.id,
          name: match.account.name,
          domain: match.account.domain || null,
        };
        pcCreateNewAccount = false;
      }
      return;
    }
    const derived = companyNameFromEmail(primary);
    if (derived) {
      writeAccountName(derived, { titleCaseOnWrite: true });
    }
  } catch {
    /* prefills are best-effort */
  }
}

/**
 * Account lookup with a create-new escape hatch.
 * Mirrors the confirm-gate account picker so intake and gate behave identically.
 * @param {{ inputEl: HTMLElement, menuEl: HTMLElement, noteEl?: HTMLElement,
 *           onPick: (account: object|null, typedName: string) => void }} cfg
 * @returns {(() => void) | undefined} teardown — call before re-attaching to the same instance
 */
function attachAccountLookup(cfg) {
  const { inputEl, menuEl, noteEl, onPick } = cfg;
  if (!inputEl || !menuEl) return undefined;

  let debounceTimer = null;
  let activeIndex = -1;
  let rows = [];
  let blurTimer = null;

  const closeMenu = () => {
    menuEl.hidden = true;
    activeIndex = -1;
    rows = [];
    menuEl.innerHTML = "";
  };

  const renderRows = (accounts, typed) => {
    const q = typed.trim().toLowerCase();
    const matches = q
      ? accounts
          .filter(
            (a) =>
              String(a.name || "").toLowerCase().includes(q) ||
              String(a.domain || "").toLowerCase().includes(q),
          )
          .slice(0, 8)
      : [];

    const exactMatch = matches.some(
      (a) => namesEqual(a.name, typed) || String(a.domain || "").toLowerCase() === q,
    );
    const html = matches
      .map(
        (a) =>
          `<button type="button" class="pc-lookup-option" role="option" data-account-id="${esc(a.id)}">
            <span>${esc(titleCaseDisplayName(a.name))}</span>
            ${a.domain ? `<span class="pc-lookup-option-sub">${esc(a.domain)}</span>` : ""}
          </button>`,
      )
      .join("");

    const createRow =
      q && !exactMatch
        ? `<button type="button" class="pc-lookup-option pc-lookup-option--create" role="option" data-create="1">
            ＋ Create new account "${esc(titleCaseDisplayName(typed.trim()))}"
          </button>`
        : "";

    menuEl.innerHTML = html + createRow;
    rows = [...menuEl.querySelectorAll(".pc-lookup-option")];
    if (!rows.length) {
      closeMenu();
      return;
    }
    menuEl.hidden = false;
    activeIndex = -1;
  };

  const pickRow = (btn) => {
    if (!btn) return;
    const typed = readFieldValue(inputEl)?.trim() || "";
    if (btn.dataset.create === "1") {
      onPick(null, typed);
      pcCreateNewAccount = true;
      pcResolvedAccount = null;
      pcSelectedDealId = null;
      pcCreateNewDeal = true;
      if (noteEl) {
        noteEl.textContent = "New account · on confirm";
        noteEl.hidden = false;
      }
    } else {
      const accountId = btn.dataset.accountId;
      postCallOwnerId()
        .then((ownerId) => buildPostCallResolveContext(ownerId, postCallResolveOpts()))
        .then((ctx) => {
          const account = (ctx.accounts || []).find((a) => a.id === accountId);
          if (account) {
            onPick(account, account.name);
            pcResolvedAccount = {
              id: account.id,
              name: account.name,
              domain: account.domain || null,
            };
            pcCreateNewAccount = false;
            pcSelectedDealId = null;
            pcCreateNewDeal = false;
            if (noteEl) noteEl.hidden = true;
          }
        })
        .catch((err) => {
          console.warn("[postcall] account lookup pick failed:", err?.message || err);
        });
    }
    closeMenu();
  };

  const refreshMenu = () => {
    const typed = readFieldValue(inputEl)?.trim() || "";
    if (!typed) {
      closeMenu();
      return;
    }
    postCallOwnerId()
      .then((ownerId) => buildPostCallResolveContext(ownerId, postCallResolveOpts()))
      .then((ctx) => renderRows(ctx.accounts || [], typed))
      .catch((err) => {
        console.warn("[postcall] account lookup failed:", err?.message || err);
        closeMenu();
      });
  };

  const scheduleRefresh = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(refreshMenu, 200);
  };

  const onKeydown = (ev) => {
    if (menuEl.hidden || !rows.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = Math.min(activeIndex + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "Enter" && activeIndex >= 0) {
      ev.preventDefault();
      pickRow(rows[activeIndex]);
    } else if (ev.key === "Escape") {
      closeMenu();
    }
  };

  const onMenuClick = (ev) => {
    const btn = ev.target?.closest?.(".pc-lookup-option");
    if (btn) pickRow(btn);
  };

  const onBlur = () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(closeMenu, 120);
  };

  const onOutsidePointerdown = (ev) => {
    if (!inputEl.contains(ev.target) && !menuEl.contains(ev.target)) closeMenu();
  };

  inputEl.addEventListener("fwInput", scheduleRefresh);
  inputEl.addEventListener("input", scheduleRefresh);
  inputEl.addEventListener("keydown", onKeydown);
  menuEl.addEventListener("click", onMenuClick);
  inputEl.addEventListener("fwBlur", onBlur);
  inputEl.addEventListener("blur", onBlur);
  document.addEventListener("pointerdown", onOutsidePointerdown);

  return () => {
    window.clearTimeout(debounceTimer);
    window.clearTimeout(blurTimer);
    inputEl.removeEventListener("fwInput", scheduleRefresh);
    inputEl.removeEventListener("input", scheduleRefresh);
    inputEl.removeEventListener("keydown", onKeydown);
    menuEl.removeEventListener("click", onMenuClick);
    inputEl.removeEventListener("fwBlur", onBlur);
    inputEl.removeEventListener("blur", onBlur);
    document.removeEventListener("pointerdown", onOutsidePointerdown);
  };
}

/**
 * Debounced contact search for confirm-gate attendee rows.
 * @param {{ inputEl: HTMLInputElement, menuEl: HTMLElement, accountId?: string|null,
 *           onPick: (contact: object) => void }} cfg
 */
function attachContactLookup(cfg) {
  const { inputEl, menuEl, accountId, onPick } = cfg;
  if (!inputEl || !menuEl) return undefined;

  let debounceTimer = null;
  let activeIndex = -1;
  let rows = [];
  let blurTimer = null;

  const closeMenu = () => {
    menuEl.hidden = true;
    activeIndex = -1;
    rows = [];
    menuEl.innerHTML = "";
  };

  const renderContactRows = (matches) => {
    if (!matches.length) {
      closeMenu();
      return;
    }
    menuEl.innerHTML = matches
      .map(
        (c) =>
          `<button type="button" class="pc-lookup-option" role="option" data-contact-id="${esc(c.id)}" data-contact-email="${esc(c.email || "")}">
            <span>${esc(c.label)}</span>
            ${c.subtitle ? `<span class="pc-lookup-option-sub">${esc(c.subtitle)}</span>` : ""}
          </button>`,
      )
      .join("");
    rows = [...menuEl.querySelectorAll(".pc-lookup-option")];
    menuEl.hidden = false;
    activeIndex = -1;
  };

  const pickRow = (btn) => {
    if (!btn) return;
    onPick({
      id: btn.dataset.contactId,
      email: btn.dataset.contactEmail || "",
      label: btn.querySelector("span")?.textContent?.trim() || "",
      subtitle: btn.querySelector(".pc-lookup-option-sub")?.textContent?.trim() || "",
    });
    closeMenu();
  };

  const refreshMenu = () => {
    const typed = readFieldValue(inputEl)?.trim() || "";
    if (typed.length < 2) {
      closeMenu();
      return;
    }
    buildSearchIndex(currentSession)
      .then((index) => {
        const matches = searchContacts(index, typed, { accountId: accountId || undefined, limit: 8 });
        renderContactRows(matches);
      })
      .catch((err) => {
        console.warn("[postcall] contact lookup failed:", err?.message || err);
        closeMenu();
      });
  };

  const scheduleRefresh = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(refreshMenu, 200);
  };

  const onKeydown = (ev) => {
    if (menuEl.hidden || !rows.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = Math.min(activeIndex + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "Enter" && activeIndex >= 0) {
      ev.preventDefault();
      pickRow(rows[activeIndex]);
    } else if (ev.key === "Escape") {
      closeMenu();
    }
  };

  const onMenuClick = (ev) => {
    const btn = ev.target?.closest?.(".pc-lookup-option");
    if (btn) pickRow(btn);
  };

  const onBlur = () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(closeMenu, 120);
  };

  const onOutsidePointerdown = (ev) => {
    if (!inputEl.contains(ev.target) && !menuEl.contains(ev.target)) closeMenu();
  };

  inputEl.addEventListener("input", scheduleRefresh);
  inputEl.addEventListener("keydown", onKeydown);
  menuEl.addEventListener("click", onMenuClick);
  inputEl.addEventListener("blur", onBlur);
  document.addEventListener("pointerdown", onOutsidePointerdown);

  return () => {
    window.clearTimeout(debounceTimer);
    window.clearTimeout(blurTimer);
    inputEl.removeEventListener("input", scheduleRefresh);
    inputEl.removeEventListener("keydown", onKeydown);
    menuEl.removeEventListener("click", onMenuClick);
    inputEl.removeEventListener("blur", onBlur);
    document.removeEventListener("pointerdown", onOutsidePointerdown);
  };
}

const FOLLOWUP_CATEGORY_LABELS = {
  decision: "Decision",
  commitment: "Commitment",
  se_action: "SE action",
  ae_action: "AE action",
  objection: "Objection",
  next_meeting: "Next meeting",
};

function influenceDot(level) {
  const cls = level === "high" ? "dot-green" : level === "medium" ? "dot-amber" : "dot-grey";
  const label = level === "high" ? "High influence" : level === "medium" ? "Medium influence" : "Low influence";
  return `<span class="power-dot ${cls}" title="${label}" aria-label="${label}"></span>`;
}

function momentumArrow(status) {
  if (status === "Advancing") return "↑";
  if (status === "At risk") return "↓";
  return "→";
}

function renderScoreGauge(score, max = 10) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dashLen = c * (score / max);
  const cls = barClass(score, max);
  return `
    <div class="qc-gauge" role="img" aria-label="Overall score ${esc(score)} out of ${esc(max)}" data-score="${esc(score)}" data-max="${esc(max)}">
      <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
        <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
          data-target-dash="${dashLen}" data-circumference="${c}"
          stroke-dasharray="0 ${c}" transform="rotate(-90 60 60)" />
      </svg>
      <div class="qc-gauge-text">
        <span class="qc-gauge-score ${cls}" data-target="${esc(score)}">0</span>
        <span class="qc-gauge-denom">/${esc(max)}</span>
      </div>
    </div>`;
}

function renderRadarChart(dimensions) {
  if (!dimensions?.length) return "";
  const n = dimensions.length;
  const cx = 130;
  const cy = 130;
  const maxR = 58;
  const labelR = maxR + 32;
  const rings = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        pts.push(`${cx + maxR * level * Math.cos(angle)},${cy + maxR * level * Math.sin(angle)}`);
      }
      return `<polygon class="qc-radar-grid" points="${pts.join(" ")}" />`;
    })
    .join("");
  const axes = dimensions
    .map((d, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x2 = cx + maxR * Math.cos(angle);
      const y2 = cy + maxR * Math.sin(angle);
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      return `
        <line class="qc-radar-axis" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" />
        ${renderRadarLabelText(radarDimensionLabel(d.name), lx, ly, angle)}`;
    })
    .join("");
  const dataPts = dimensions.map((d, i) => {
    const pct = d.score / d.maxScore;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rad = maxR * pct;
    return `${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`;
  });
  const dots = dimensions
    .map((d, i) => {
      const pct = d.score / d.maxScore;
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rad = maxR * pct;
      return `<circle class="qc-radar-dot" cx="${cx + rad * Math.cos(angle)}" cy="${cy + rad * Math.sin(angle)}" r="3.5" />`;
    })
    .join("");
  return `
    <div class="qc-radar-wrap">
      <p class="qc-radar-title">Dimension profile</p>
      <svg class="qc-radar qc-radar-anim" viewBox="0 0 260 260" role="img" aria-label="Radar chart of coaching dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" data-anim="radar" />
        ${dots}
      </svg>
    </div>`;
}

function renderDimensionRows(dimensions) {
  if (!dimensions?.length) return '<p class="muted">No dimension scores.</p>';
  return dimensions
    .map((d) => {
      const pct = scorePct(d.score, d.maxScore);
      const cls = barClass(d.score, d.maxScore);
      return `
        <details class="qc-dim">
          <summary class="qc-dim-summary">
            <span class="qc-dim-name">${esc(d.name)}</span>
            <span class="qc-dim-bar" aria-hidden="true">
              <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
            </span>
            <span class="qc-dim-score ${cls}">${esc(d.score)}/${esc(d.maxScore)}</span>
          </summary>
          <div class="qc-dim-body">
            <p class="qc-dim-feedback">${truncateWords(d.feedback, 12)}</p>
            <blockquote class="qc-dim-evidence"><span class="qc-ev-label">Evidence</span>${truncateWords(d.evidence, 12)}</blockquote>
          </div>
        </details>`;
    })
    .join("");
}

function renderInsightList(items, title, tone) {
  const list = (items || []).filter((x) => !isUnknown(x));
  const html = list.length
    ? `<ul>${list.map((i) => `<li>${truncateWords(i, 12)}</li>`).join("")}</ul>`
    : '<p class="muted">None noted.</p>';
  return `<div class="qc-insight qc-insight-${tone}"><h4>${esc(title)}</h4>${html}</div>`;
}

function renderQualityCoach(qc) {
  const normalized = normalizeQualityCoach(qc);
  const dims = normalized.dimensions || [];
  return `
    <div class="qc-dashboard">
      <div class="qc-hero">
        ${renderScoreGauge(normalized.overallScore, 10)}
        <div class="qc-hero-meta">
          <span class="qc-overall-label">${esc(normalized.overallLabel)}</span>
          <p class="muted qc-hero-hint">Quality score (separate from deal momentum above).</p>
        </div>
      </div>
      ${renderRadarChart(dims)}
    </div>
    <div class="qc-insights qc-insights-compact">
      ${renderInsightList(normalized.strengths?.slice(0, 2), "Top strengths", "good")}
      ${renderInsightList(normalized.improvements?.slice(0, 2), "Top improvements", "ok")}
      ${renderInsightList(normalized.missedOpportunities?.slice(0, 1), "Missed opportunity", "weak")}
    </div>
    <details class="qc-details sources">
      <summary>Details: full scorecard</summary>
      <div class="qc-scorecard">
        <div class="qc-dim-list">${renderDimensionRows(dims)}</div>
      </div>
    </details>`;
}

function renderLegacyPostCall(data, meta) {
  const a = data.analysis;
  const cs = a.callSummary || {};
  return `
    <fw-inline-message type="warning" open closable="false">This analysis uses an older format. Re-run analysis for the new post-call one-pager.</fw-inline-message>
    <div class="head"><h2 class="one-pager-title">${esc(cs.headline || meta.title || "Call analysis")}</h2></div>`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function radarPolygonPerimeter(polygon) {
  const pts = (polygon.getAttribute("points") || "")
    .trim()
    .split(/\s+/)
    .map((p) => p.split(",").map(Number));
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return len;
}

function animateScoreGauge(gauge, duration = 380) {
  const fill = gauge?.querySelector(".qc-gauge-fill");
  const scoreEl = gauge?.querySelector(".qc-gauge-score[data-target]");
  if (!fill || !scoreEl) return;

  const targetDash = parseFloat(fill.dataset.targetDash || "0");
  const circumference = parseFloat(fill.dataset.circumference || "0");
  const targetScore = parseFloat(scoreEl.dataset.target || "0");

  if (prefersReducedMotion()) {
    fill.style.strokeDasharray = `${targetDash} ${circumference}`;
    scoreEl.textContent = String(targetScore);
    return;
  }

  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const dash = targetDash * eased;
    fill.style.strokeDasharray = `${dash} ${circumference}`;
    scoreEl.textContent = String(Math.round(targetScore * eased * 10) / 10);
    if (t < 1) requestAnimationFrame(tick);
    else scoreEl.textContent = String(targetScore);
  }
  requestAnimationFrame(tick);
}

export function initPostCallAnimations(root) {
  if (!root) return;
  root.classList.add("anim-root");

  const blocks = root.querySelectorAll(".header-strip, .momentum-hero, section, .prep-footer");
  blocks.forEach((el, i) => {
    el.classList.add("anim-block");
    el.style.setProperty("--anim-delay", `${i * 50}ms`);
  });

  const radarPoly = root.querySelector(".qc-radar-data[data-anim]");
  if (radarPoly) {
    const perimeter = radarPolygonPerimeter(radarPoly);
    radarPoly.style.setProperty("--radar-perimeter", String(perimeter));
    radarPoly.style.strokeDasharray = `${perimeter}`;
    radarPoly.style.strokeDashoffset = String(perimeter);
  }

  root.querySelectorAll(".qc-gauge[data-score]").forEach((gauge) => animateScoreGauge(gauge));

  if (prefersReducedMotion()) {
    root.classList.add("anim-ready");
    if (radarPoly) radarPoly.style.strokeDashoffset = "0";
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add("anim-ready");
      if (radarPoly) radarPoly.style.strokeDashoffset = "0";
    });
  });
}

function getCallTitle(analysis, meta) {
  return analysis?.callHeader?.title || analysis?.callSummary?.headline || meta.title || "Call analysis";
}

function coalesceAttendees(analysis) {
  const hdr = analysis?.callHeader || {};
  const cs = analysis?.callSummary || {};
  const list = hdr.attendees ?? analysis?.attendees ?? cs.attendees ?? [];
  return Array.isArray(list) ? list : [];
}

function normalizeActionKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function actionTextsSimilar(a, b) {
  const na = normalizeActionKey(a);
  const nb = normalizeActionKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
}

function followUpTexts(followUpTable) {
  return (followUpTable || [])
    .flatMap((row) => [row.thisCall, row.followUp])
    .filter((t) => !isUnknown(t));
}

function dedupeNextSteps(nextSteps, followUpTable) {
  const fuTexts = followUpTexts(followUpTable);
  return (nextSteps || []).filter((step) => {
    if (step.isRisk) return true;
    if (isUnknown(step.action)) return false;
    return !fuTexts.some((fu) => actionTextsSimilar(step.action, fu));
  });
}

function inferSeOwner(attendees) {
  const se = (attendees || []).find((a) => /se|solution|engineer/i.test(String(a.role ?? "")));
  if (se && !isUnknown(se.name)) return se.name;
  const named = (attendees || []).find((a) => !isUnknown(a.name));
  return named?.name || "SE";
}

function injectRiskRow(nextSteps, missed, momentum, attendees) {
  if (isUnknown(missed)) return nextSteps || [];
  const action = String(missed).replace(/^risk:\s*/i, "").trim();
  if (isUnknown(action)) return nextSteps || [];
  const steps = nextSteps || [];
  if (steps.some((s) => s.isRisk || actionTextsSimilar(s.action, action))) return steps;
  return [{
    owner: inferSeOwner(attendees),
    action,
    due: "Next call",
    why: momentum?.reason && !isUnknown(momentum.reason) ? momentum.reason : "Deal momentum at risk",
    isRisk: true,
  }, ...steps];
}

/** Normalize v4 + partial v5 + v2 (QIP) payloads before render. */
function normalizeAnalysisForRender(raw) {
  if (!raw) return null;
  const version = raw.analysisVersion ?? 1;
  const cs = raw.callSummary || {};
  const hdr = raw.callHeader || {};
  const attendees = coalesceAttendees(raw);
  const followUpTable = raw.followUpTable || [];
  const momentum = raw.momentum || {};
  const qualityCoach = raw.qualityCoach || {
    dimensions: [],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  };
  const missed = (qualityCoach.missedOpportunities || []).find((x) => !isUnknown(x));
  const nextSteps = dedupeNextSteps(
    injectRiskRow(raw.nextSteps || [], missed, momentum, attendees),
    followUpTable,
  );

  return {
    ...raw,
    analysisVersion: version,
    callHeader: {
      title: hdr.title || cs.headline || raw.title || "",
      duration: hdr.duration || cs.duration || raw.duration || "",
      date: hdr.date || cs.date || raw.date || "",
      attendees,
    },
    momentum,
    signals: raw.signals || { painsConfirmed: [], objectionsOpen: [], competitors: [] },
    followUpTable,
    nextSteps,
    qualityCoach,
    artifacts: raw.artifacts || {
      suggestedFollowUpEmail: { subject: "", body: "" },
      crmNotes: "",
    },
    callNotes: typeof raw.callNotes === "string" ? raw.callNotes : "",
  };
}

function formatEvidenceAt(atS) {
  if (atS == null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.floor(atS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function qipScoreTone(score) {
  if (score >= 8) return "good";
  if (score >= 6) return "ok";
  return "weak";
}

function qipScoreColor(score) {
  if (score >= 8) return "var(--green)";
  if (score >= 6) return "var(--amber)";
  return "var(--red)";
}

function qipConfidenceTier(conf) {
  if (conf == null) return null;
  if (conf >= 0.65) return "High";
  if (conf >= 0.4) return "Med";
  return "Low";
}

function qipConfidencePill(conf, fallbackConf) {
  const c = conf ?? fallbackConf;
  const tier = qipConfidenceTier(c);
  if (!tier) return `<span class="pill">-</span>`;
  if (tier === "High") return '<span class="pill high">High</span>';
  if (tier === "Med") return '<span class="pill med">Med</span>';
  return '<span class="pill low">Low</span>';
}

function qipLineGrade(line) {
  return lineGradeForDisplay(line);
}

function qipLineCredit(line) {
  if (typeof line.credit === "number") return line.credit;
  if ((line.weight || 0) >= 10) return 3;
  if ((line.weight || 0) >= 5) return 2;
  return 1;
}

function qipThemeContribution(line) {
  if (isThemeExcludedFromAggregate(line)) return -1;
  if (isThemeScoreSuppressed(line.themeKey)) return -1;
  const grade = qipLineGrade(line);
  if (grade == null) return -1;
  return grade * qipLineCredit(line);
}

function qipInsightText(line) {
  const label = themeLabel(line.themeKey);
  const note =
    line.coachingNote && !isUnknown(line.coachingNote)
      ? truncateWordsPlain(sanitizeUserFacingCopy(line.coachingNote), 18)
      : null;
  const grade = qipLineGrade(line);
  if (note) return `${label} — ${note}`;
  if (grade != null) return `${label} scored ${grade} / 10 on this call.`;
  return label;
}

function deriveQipInsights(lines) {
  const ranked = coerceScorecardLines(lines)
    .filter((l) => qipThemeContribution(l) >= 0)
    .sort((a, b) => qipThemeContribution(b) - qipThemeContribution(a));
  return {
    good: ranked.slice(0, 3).map(qipInsightText),
    bad: [...ranked].reverse().slice(0, 3).map(qipInsightText),
  };
}

function qipCategoryLines(lines, categoryKey, callType) {
  const safeCallType = canonicalCallType(callType || "demo");
  const safeLines = coerceScorecardLines(lines);
  const filtered = safeLines.filter((line) => {
    if (line.category) return line.category === categoryKey;
    try {
      const profile = profileFor(canonicalCallType(line.callType || safeCallType));
      const theme = profile.themes.find((t) => t.key === line.themeKey);
      return theme?.category === categoryKey;
    } catch {
      return false;
    }
  });
  try {
    const profile = profileFor(safeCallType);
    const order = profile.themes.filter((t) => t.category === categoryKey).map((t) => t.key);
    return order.map((key) => filtered.find((l) => l.themeKey === key)).filter(Boolean);
  } catch {
    return filtered;
  }
}

function qipCategoryConfidence(lines, fallbackConf) {
  const vals = (lines || [])
    .filter((l) => !isThemeExcludedFromAggregate(l))
    .map((l) => l.confidence)
    .filter((c) => c != null);
  if (!vals.length) return fallbackConf;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const QIP_CHEV_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const QIP_CHEV_SVG_SM =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const QIP_STAR_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.5 2.6a.5.5 0 0 1 .9 0l2.5 5.1 5.6.8a.5.5 0 0 1 .3.9l-4 3.9 1 5.6a.5.5 0 0 1-.8.5L12 17.3l-5 2.6a.5.5 0 0 1-.8-.5l1-5.6-4-3.9a.5.5 0 0 1 .3-.9l5.6-.8Z"/></svg>';

function qipScoreHex(score) {
  if (score >= 8) return "#4a7a5c";
  if (score >= 6) return "#a5883f";
  return "#b8544a";
}

function renderQipSparkline(subParameters) {
  const scores = (subParameters || []).slice(0, 5).map((sp) => Math.max(0, Math.min(2, Number(sp?.score ?? sp?.grade ?? 0) || 0)));
  while (scores.length < 5) scores.push(0);
  const bars = scores
    .map((s) => {
      if (s >= 2) return '<i class="v2"></i>';
      if (s >= 1) return '<i class="v1"></i>';
      return '<i class="v0"></i>';
    })
    .join("");
  return `<span class="spark" aria-label="checks: ${esc(scores.join(","))}">${bars}</span>`;
}

function renderQipWeightBars(credit, title) {
  const n = Math.max(0, Math.min(3, Number(credit) || 0));
  const bars = [0, 1, 2].map((i) => `<i${i < n ? ' class="on"' : ""}></i>`).join("");
  return `<span class="wt" title="${esc(title || `Credit ${n}`)}">${bars}</span>`;
}

function renderQipStateChip(score) {
  const n = Math.max(0, Math.min(2, Number(score) || 0));
  if (n >= 2) return '<span class="chip done">✓ Done <span class="frac">2/2</span></span>';
  if (n >= 1) return '<span class="chip part">◐ Partial <span class="frac">1/2</span></span>';
  return '<span class="chip miss">○ Missed <span class="frac">0/2</span></span>';
}

function renderWireframeSubParameter(spLabel, sp, coachOutput, themeKey, spIndex, lineCoachingNote) {
  const score = sp?.score ?? 0;
  const evidence = (sp?.evidence || []).filter((e) => e?.quote && !isUnknown(e.quote));
  const evidenceHtml = evidence.length
    ? evidence
        .map((e) => {
          const ts = formatEvidenceAt(e.atS);
          return `<div class="ev">${ts != null ? `<span class="t">${esc(ts)}</span>` : ""}<span class="q">${truncateWords(e.quote, 35)}</span></div>`;
        })
        .join("")
    : "";
  const coachText = resolveSubParameterCoachText(sp, coachOutput, themeKey, spIndex, spLabel, lineCoachingNote);
  const nailed = score >= 2 ? '<div class="nailed">✓ Nailed it</div>' : "";
  const coach =
    score < 2 && coachText
      ? `<div class="coach"><span class="k">Coach</span><span class="c">${esc(coachText)}</span></div>`
      : "";
  return `
    <div class="sp">
      <div class="state">${renderQipStateChip(score)}</div>
      <div>
        <div class="txt">${esc(spLabel)}</div>
        ${evidenceHtml}
        ${nailed}
        ${coach}
      </div>
    </div>`;
}

function renderWireframeThemeRow(line, profileTheme, fallbackConf, coachOutput, profile) {
  const na = line.evidenceUnavailable || line.applicable === false;
  const grade = qipLineGrade(line);
  const credit = profileTheme?.credit ?? qipLineCredit(line);
  const creditLabel =
    credit >= 3 ? "Credit 3 — carries the call" : credit >= 2 ? "Credit 2 — matters" : "Credit 1 — polish";
  const subLabels = profileTheme?.subParameters || [];
  const subParams = na
    ? []
    : (() => {
        const coerced = coerceSubParameters(line.subParameters);
        return coerced.length ? coerced : legacySubParametersFromLine(line);
      })();

  if (na) {
    return `
      <details class="thm" data-theme-key="${esc(line.themeKey)}">
        <summary class="thm-sum">
          <span class="thm-name"><span class="nm">${esc(themeLabel(line.themeKey))}</span>${renderQipWeightBars(credit, creditLabel)}</span>
          <span></span>
          <span class="thm-na">N/A</span>
          <span></span><span></span>
          <span class="chev">${QIP_CHEV_SVG_SM}</span>
        </summary>
        <div class="thm-body">
          <p class="thm-note">${esc(resolveThemeNaReason(line, profile))}</p>
        </div>
      </details>`;
  }

  const scoreHtml =
    grade != null
      ? `<span class="thm-score" style="color:${qipScoreHex(grade)}">${esc(grade)}<span class="d"> / 10</span></span>`
      : `<span class="thm-na">N/A</span>`;
  const subRows = subParams.length
    ? subParams
        .map((sp, i) =>
          renderWireframeSubParameter(
            subLabels[i] || `Check ${i + 1}`,
            sp,
            coachOutput,
            line.themeKey,
            i,
            line.coachingNote,
          ),
        )
        .join("")
    : "";

  return `
    <details class="thm" data-theme-key="${esc(line.themeKey)}">
      <summary class="thm-sum">
        <span class="thm-name"><span class="nm">${esc(themeLabel(line.themeKey))}</span>${renderQipWeightBars(credit, creditLabel)}</span>
        ${renderQipSparkline(subParams)}
        ${scoreHtml}
        ${qipConfidencePill(line.confidence, fallbackConf)}
        <span></span>
        <span class="chev">${QIP_CHEV_SVG_SM}</span>
      </summary>
      <div class="thm-body">${subRows ? `<div class="qip-subparam-list">${subRows}</div>` : `<p class="thm-note muted">No checks scored.</p>`}</div>
    </details>`;
}

function renderWireframeCategoryRow(categoryKey, score, lines, profile, callType, fallbackConf, coachOutput) {
  const name = qipCategoryDisplayLabel(categoryKey);
  const catLines = qipCategoryLines(lines, categoryKey, callType);
  const catConf = qipCategoryConfidence(catLines, fallbackConf);
  const themes = catLines
    .map((line) => {
      const profileTheme = profile?.themes?.find((t) => t.key === line.themeKey) || null;
      return renderWireframeThemeRow(line, profileTheme, fallbackConf, coachOutput, profile);
    })
    .join("");
  const summaryNote =
    !themes && catLines.length === 0
      ? `<p class="thm-note">Open to see themes and checks for this category.</p>`
      : "";

  return `
    <details class="cat">
      <summary class="cat-sum">
        <span class="cat-star" style="color:${qipScoreHex(score)}">${QIP_STAR_SVG}</span>
        <span class="cat-name">${esc(name)}</span>
        <span class="cat-score" style="color:${qipScoreHex(score)}">${esc(score)}<span class="d"> / 10</span></span>
        ${qipConfidencePill(catConf, fallbackConf)}
        <span class="chev">${QIP_CHEV_SVG}</span>
      </summary>
      <div class="cat-body">${themes || summaryNote}</div>
    </details>`;
}

function renderQipInsightTile(items, title, tone) {
  const list = (items || []).slice(0, 3);
  const iconGood =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
  const iconBad =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  const body = list.length
    ? `<ul>${list.map((text) => `<li><span class="ic">${tone === "good" ? iconGood : iconBad}</span>${esc(text)}</li>`).join("")}</ul>`
    : `<ul><li class="muted">None flagged.</li></ul>`;
  return `<div class="col ${tone === "good" ? "good" : "bad"}"><div class="h">${esc(title)}</div>${body}</div>`;
}

function renderQipInsightTileLegacy(items, title, tone) {
  const icon = tone === "good" ? "✓" : "!";
  const list = (items || []).slice(0, 3);
  const body = list.length
    ? list
        .map(
          (text) =>
            `<div class="qip-insight-row qip-insight-row--${tone}"><span class="qip-insight-icon" aria-hidden="true">${icon}</span><span>${esc(text)}</span></div>`,
        )
        .join("")
    : `<p class="muted qip-insight-empty">None flagged.</p>`;
  return `<div class="qip-insight-col qip-insight-col--${tone}"><span class="qip-insight-title">${esc(title)}</span>${body}</div>`;
}

function renderSubParameterScoreBar(score) {
  const filled = Math.max(0, Math.min(2, Number(score) || 0));
  return `<div class="qip-sp-bar" role="img" aria-label="Score ${filled} of 2">${[0, 1]
    .map((i) => `<span class="qip-sp-bar-seg${i < filled ? " is-filled" : ""}"></span>`)
    .join("")}</div>`;
}

function resolveSubParameterCoachText(sp, coachOutput, themeKey, spIndex, spLabel, lineCoachingNote) {
  const coachText = coachTextForSubParameter(coachOutput, themeKey, spIndex);
  const score = sp?.score ?? 0;
  if (coachText) {
    return truncateWords(sanitizeUserFacingCopy(coachText), 45);
  }
  const tip = insightfulCoachTip(spLabel, themeKey, spIndex, score);
  if (tip) return truncateWords(sanitizeUserFacingCopy(tip), 45);
  if (lineCoachingNote && score < 2 && !isUnknown(lineCoachingNote)) {
    return truncateWords(sanitizeUserFacingCopy(lineCoachingNote), 45);
  }
  if (score >= 2) return "Full credit — no coaching needed here.";
  return "Listen back for a moment where this rubric bar was missed, then plan one concrete fix for next call.";
}

function renderQipSubParameter(spLabel, sp, coachOutput, themeKey, spIndex, themeCredit) {
  const score = sp?.score ?? 0;
  const evidence = (sp?.evidence || []).filter((e) => e?.quote && !isUnknown(e.quote));
  const evidenceHtml = evidence.length
    ? evidence
        .map((e) => {
          const ts = formatEvidenceAt(e.atS);
          return `<div class="qip-sp-evidence">${ts != null ? `<span class="qip-sp-ts">${esc(ts)}</span>` : ""}<blockquote>${truncateWords(e.quote, 35)}</blockquote></div>`;
        })
        .join("")
    : "";
  const coachText = resolveSubParameterCoachText(sp, coachOutput, themeKey, spIndex, spLabel);
  const creditBadge =
    themeCredit != null ? `<span class="qip-sp-credit muted">${esc(String(themeCredit))} cr</span>` : "";
  return `
    <div class="qip-sp-row">
      <div class="qip-sp-label">${esc(spLabel)} ${creditBadge}</div>
      <div class="qip-sp-score">${renderSubParameterScoreBar(score)}</div>
      <div class="qip-sp-evidence-wrap">${evidenceHtml || '<span class="muted qip-sp-no-evidence">No evidence</span>'}</div>
      <p class="qip-sp-coach muted">${esc(coachText)}</p>
    </div>`;
}

function renderQipThemeRow(line, profileTheme, fallbackConf, wireframe, coachOutput, profile) {
  const na = line.evidenceUnavailable || line.applicable === false;
  const suppressed = !na && isThemeScoreSuppressed(line.themeKey);
  const heavy = qipLineCredit(line) >= 3;
  const grade = qipLineGrade(line);
  const tone = grade != null ? qipScoreTone(grade) : "weak";
  const pct = grade != null ? Math.min(100, Math.max(0, (grade / 10) * 100)) : 0;
  const cls = [
    "qip-theme-row",
    wireframe ? "srow" : "",
    suppressed ? "qip-theme-row-suppressed" : "",
    heavy ? "qip-theme-row-heavy" : "",
    na ? "qip-theme-row-na" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const scoreCol = na
    ? `<span class="qip-na-badge">N/A</span>`
    : suppressed
      ? `<span class="qip-suppressed-badge">${esc(THEME_SCORE_SUPPRESSION_MESSAGE)}</span>`
      : `<span class="qip-theme-score ${tone}"><strong style="color:${qipScoreColor(grade)}">${esc(grade)}</strong><span class="qip-line-max"> / 10</span></span>`;

  const barCol =
    na || suppressed || grade == null
      ? `<span class="muted">-</span>`
      : `<div class="bar qip-theme-bar"><span style="width:${Math.max(pct, grade === 0 ? 0 : 4)}%;background:${qipScoreColor(grade)}"></span></div>`;

  const subLabels = profileTheme?.subParameters || [];
  const subParams = na
    ? []
    : (() => {
        const coerced = coerceSubParameters(line.subParameters);
        return coerced.length ? coerced : legacySubParametersFromLine(line);
      })();
  const subRows =
    !na && subParams.length
      ? subParams
          .map((sp, i) =>
            renderQipSubParameter(
              subLabels[i] || `Sub-parameter ${i + 1}`,
              sp,
              coachOutput,
              line.themeKey,
              i,
              profileTheme?.credit,
            ),
          )
          .join("")
      : "";

  const reason =
    na
      ? `<p class="qip-na-reason">${esc(resolveThemeNaReason(line, profile))}</p>`
      : "";

  return `
    <details class="${cls}" data-theme-key="${esc(line.themeKey)}">
      <summary class="qip-theme-summary${wireframe ? " srow-hd" : ""}">
        <div class="qip-theme-cell">
          <span class="qip-theme-name${heavy ? " qip-theme-name--heavy" : ""}">${esc(themeLabel(line.themeKey))}</span>
          ${heavy ? '<span class="pill purple qip-heavy-pill">3 cr</span>' : ""}
          ${line.sourceHint && !isUnknown(line.sourceHint) ? `<div class="sub qip-theme-hint">${esc(line.sourceHint)}</div>` : ""}
        </div>
        <div class="qip-score-cell">${scoreCol}</div>
        <div class="qip-bar-cell">${barCol}</div>
        <div class="qip-conf-cell">${na ? "" : qipConfidencePill(line.confidence, fallbackConf)}</div>
        <div class="chev" aria-hidden="true">›</div>
      </summary>
      <div class="qip-theme-body${wireframe ? " srow-bd" : ""}">
        ${reason}
        ${subRows ? `<div class="qip-subparam-list">${subRows}</div>` : ""}
      </div>
    </details>`;
}

function qipCategoryDisplayLabel(categoryKey) {
  const radar = QIP_RADAR_LABELS[categoryKey];
  if (radar) return radar.replace(/\n/g, " ");
  return CATEGORY_LABELS[categoryKey] || categoryKey;
}

function renderQipCategoryRow(categoryKey, score, lines, profile, callType, fallbackConf, wireframe, coachOutput) {
  if (wireframe) {
    return renderWireframeCategoryRow(categoryKey, score, lines, profile, callType, fallbackConf, coachOutput);
  }
  const name = qipCategoryDisplayLabel(categoryKey);
  const catLines = qipCategoryLines(lines, categoryKey, callType);
  const catConf = qipCategoryConfidence(catLines, fallbackConf);
  const themes = catLines
    .map((line) => {
      const profileTheme = profile?.themes?.find((t) => t.key === line.themeKey) || null;
      return renderQipThemeRow(line, profileTheme, fallbackConf, wireframe, coachOutput, profile);
    })
    .join("");

  return `
    <details class="qip-category-row qip-category-row--${qipScoreTone(score)}">
      <summary class="qip-category-summary">
        <span class="qip-category-star" style="color:${qipScoreColor(score)}" aria-hidden="true">★</span>
        <span class="qip-category-name">${esc(name)}</span>
        <span class="qip-category-score"><strong style="color:${qipScoreColor(score)}">${esc(score)}</strong><span class="qip-line-max"> / 10</span></span>
        ${qipConfidencePill(catConf, fallbackConf)}
        <span class="chev" aria-hidden="true">›</span>
      </summary>
      <div class="qip-category-body">${themes || '<p class="muted">No themes in this category.</p>'}</div>
    </details>`;
}

/** v2.1 QIP scorecard — /10 categories, radar, insight tiles, theme → sub-parameter drill-down. */
export function renderQipScorecard(scorecard, analysisMeta = {}, opts = {}) {
  if (!scorecard) {
    return '<fw-inline-message type="warning" open closable="false">No QIP scorecard lines returned.</fw-inline-message>';
  }

  const wireframe = opts.context === "call-record";
  const normalized = normalizeQipScorecard(scorecard, analysisMeta);
  if (!normalized.lines?.length && normalized.overall == null) {
    return '<fw-inline-message type="warning" open closable="false">No QIP scorecard lines returned.</fw-inline-message>';
  }
  const { callType, overall, categoryScores, lines, provisional, confidence } = normalized;
  const callTypeLabel = CALL_TYPE_LABELS[callType] || callType;
  const confPct = confidence != null ? Math.round(confidence * 100) : null;
  const overallLabel = overall != null ? `${overall} / 10` : "- / 10";
  const { good, bad } = deriveQipInsights(lines);

  let profile = null;
  try {
    profile = profileFor(callType);
  } catch {
    profile = null;
  }

  const coachOutput =
    opts.coachOutput ??
    buildCoachOutput({
      callId: opts.callId,
      callType,
      lines,
      overrides: opts.overrides ?? loadScoreOverrides(),
      audience: opts.coachAudience ?? "se",
    });

  const categoryRows = CATEGORY_KEYS.map((key) =>
    renderQipCategoryRow(
      key,
      categoryScores[key] ?? 0,
      lines,
      profile,
      callType,
      confidence,
      wireframe,
      coachOutput,
    ),
  ).join("");

  const actionsHtml = wireframe
    ? ""
    : `<div class="qip-scorecard-actions">
        <button type="button" class="btn-wire sm" disabled title="Score override (coming soon)">Override a score</button>
        <button type="button" class="btn-wire sm" disabled title="Compare to my average (coming soon)">Compare to my average</button>
      </div>`;

  if (wireframe) {
    const overallDisplay = overall != null ? esc(String(overall)) : "-";
    const callIdAttr = opts.callId ? ` data-call-id="${esc(opts.callId)}"` : "";
    const companyAttr = opts.company ? ` data-company="${esc(opts.company)}"` : "";
    const scoreAttr =
      overall != null
        ? ` data-score="${esc(String(overall))}" data-grade="${esc(String(overall))}"`
        : "";
    const wireActionsHtml = `<div class="qip-wire-actions" aria-label="Score actions">
          <button type="button" class="btn-wire sm score-dispute-trigger"${callIdAttr}${companyAttr}${scoreAttr}>Dispute a score</button>
          <button type="button" class="btn-wire sm score-override-trigger"${callIdAttr}>Override a score</button>
          <button type="button" class="btn-wire sm" disabled title="Compare to my average (coming soon)">Compare to my average</button>
        </div>`;
    return `
      <section class="card qip qip-scorecard qip-scorecard--wireframe${provisional ? " qip-provisional" : ""}">
        <div class="qip-head">
          <div>
            <h2>QIP scorecard ${provisional ? '<span class="pill qip-provisional-badge">Provisional</span>' : ""}</h2>
          </div>
          <span class="qip-total"><b>${overallDisplay}</b> / 10 · overall</span>
        </div>
        <div class="legend" aria-label="How to read this scorecard">
          <span class="lk">How to read this</span>
          <span class="item">Each theme is scored <b style="color:#2b2926;font-weight:800">/10</b> from five checks —</span>
          <span class="item"><span class="chip done">✓ Done <span class="frac">2</span></span></span>
          <span class="item"><span class="chip part">◐ Partial <span class="frac">1</span></span></span>
          <span class="item"><span class="chip miss">○ Missed <span class="frac">0</span></span></span>
          <span class="item" style="margin-left:4px">Weight
            <span class="wt" title="carries the call"><i class="on"></i><i class="on"></i><i class="on"></i></span>carries the call ·
            <span class="wt" title="matters"><i class="on"></i><i class="on"></i><i></i></span>matters ·
            <span class="wt" title="polish"><i class="on"></i><i></i><i></i></span>polish
          </span>
        </div>
        <div class="wd">
          ${renderQipInsightTile(good, "What worked", "good")}
          ${renderQipInsightTile(bad, "What didn't", "bad")}
        </div>
        <div class="cats">${categoryRows}</div>
        ${wireActionsHtml}
      </section>`;
  }

  return `
    <div class="qip-scorecard${provisional ? " qip-provisional" : ""}">
      <div class="qip-scorecard-card qip-scorecard-head-card">
        <div class="qip-scorecard-head">
          <div>
            <h2 class="qip-scorecard-title">QIP · ${esc(callTypeLabel.toLowerCase())} profile${provisional ? ' <span class="pill qip-provisional-badge">Provisional</span>' : ""}</h2>
            ${confPct != null ? `<p class="sub qip-confidence">Analysis confidence ${esc(confPct)}%</p>` : ""}
          </div>
          <span class="pill qip-overall-pill">${esc(overallLabel)}</span>
        </div>
        <div class="qip-insights-grid">
          ${renderQipInsightTileLegacy(good, "What worked", "good")}
          ${renderQipInsightTileLegacy(bad, "What didn't", "bad")}
        </div>
      </div>
      ${renderQipRadar(categoryScores, { overallScore: overall, title: "Evaluation signal", animate: true })}
      <div class="qip-scorecard-card qip-category-card">
        ${categoryRows}
      </div>
      ${actionsHtml}
    </div>`;
}
function renderVideoNaBanner(data) {
  const themes =
    data?.analysisMeta?.videoThemesNotApplicable ||
    data?.resolve?.videoThemesNotApplicable ||
    [];
  const videoAvailable =
    data?.analysisMeta?.videoAvailable ?? data?.resolve?.videoAvailable;
  if (!themes.length || videoAvailable) return "";
  const conf = data?.analysisMeta?.analysisConfidence ?? data?.resolve?.analysisConfidence;
  const confPct = conf != null ? Math.round(conf * 100) : null;
  const labels = themes
    .map((t) => VIDEO_THEME_LABELS[t.themeKey] || t.themeKey)
    .join(", ");
  return `<fw-inline-message type="warning" open closable="false">
    Video themes not scored (${esc(labels)}). Denominator renormalised${confPct != null ? `; analysis confidence ${esc(confPct)}%` : ""}.
  </fw-inline-message>`;
}

function renderConfirmedReadOnlyBanner(data) {
  const c = data?.confirmed;
  const am = data?.analysisMeta;
  if (!c && !am) return "";
  const callType = c?.callType || am?.callType;
  const callLabel = CALL_TYPE_LABELS[callType] || callType || "-";
  const accountName =
    data?.resolve?.account?.accountName ||
    data?.analysis?.callHeader?.company ||
    "-";
  const deal =
    data?.resolve?.deals?.find((d) => d.dealId === c?.dealId) ||
    data?.resolve?.deals?.find((d) => d.preselected);
  const dealLabel = deal?.title || c?.dealId || "-";
  const accountId = data?.resolve?.account?.accountId || c?.accountId || null;
  const dealId = c?.dealId || deal?.dealId || null;
  const accountLink = accountId
    ? `<a href="#accounts/${esc(accountId)}" class="postcall-nav-link" data-postcall-nav="account">${esc(accountName)}</a>`
    : esc(accountName);
  const dealLink = dealId
    ? `<a href="#deals/${esc(dealId)}" class="postcall-nav-link" data-postcall-nav="deal">${esc(dealLabel)}</a>`
    : esc(dealLabel);
  const overrideNotes = [];
  if (c?.callTypeOverride) {
    overrideNotes.push(
      `Call type corrected from ${CALL_TYPE_LABELS[c.callTypeOverride.from] || c.callTypeOverride.from}`,
    );
  }
  if (c?.dealMatchOverride) {
    overrideNotes.push("Deal selection corrected");
  }
  return `<div class="postcall-confirmed-banner" aria-label="Confirmed match summary">
    <strong>Confirmed</strong>. Account: ${accountLink} · Deal: ${dealLink} · Call type: ${esc(callLabel)}
    ${overrideNotes.length ? `<span class="muted"> (${esc(overrideNotes.join("; "))})</span>` : ""}
  </div>${renderVideoNaBanner(data)}`;
}

export function renderPostCall(data, meta = {}) {
  const raw = data?.analysis;
  if (!raw) {
    return `<fw-inline-message type="error" open closable="false">No analysis data returned. Try running analysis again.</fw-inline-message>`;
  }
  if (!raw?.callHeader && raw?.callSummary && !raw?.momentum?.status) {
    return renderLegacyPostCall(data, meta);
  }

  const a = normalizeAnalysisForRender(raw);
  if (!a) {
    return `<fw-inline-message type="error" open closable="false">Could not normalize analysis for display.</fw-inline-message>`;
  }
  const hdr = a.callHeader;
  const mom = a.momentum;
  const sig = a.signals;
  const arts = a.artifacts;
  const tm = data.transcriptMeta || {};
  const scorecard = data.scorecard;
  const useQip = !!(scorecard?.lines?.length || a.analysisVersion === 2);

  const attendeeChips = hdr.attendees.length
    ? hdr.attendees
        .map((x) => {
          const parts = [`<span class="attendee-chip">${influenceDot(x.influence)}${dash(x.name)}`];
          if (!isUnknown(x.role)) parts.push(`<span class="chip-role">${truncateWords(x.role, 8)}</span>`);
          parts.push("</span>");
          return parts.join(" · ");
        })
        .join("")
    : '<span class="muted">-</span>';

  const metaLine = [hdr.duration, hdr.date].filter((x) => !isUnknown(x)).map(esc).join(" · ");

  const followRows = (a.followUpTable || [])
    .filter((row) => !isUnknown(row.thisCall) || !isUnknown(row.followUp))
    .map(
      (row) => `<tr>
        <th class="prep-row-label">${esc(FOLLOWUP_CATEGORY_LABELS[row.category] || row.category)}</th>
        <td>${truncateWords(row.thisCall, 8)}</td>
        <td>${truncateWords(row.followUp, 8)}</td>
      </tr>`,
    )
    .join("");

  const followTable = followRows
    ? `<table class="prep-compare call-compare">
        <thead><tr><th></th><th>This call</th><th>Follow-up</th></tr></thead>
        <tbody>${followRows}</tbody>
      </table>`
    : '<p class="muted">-</p>';

  const signalCol = (items) => {
    const list = (items || []).filter((x) => !isUnknown(x)).slice(0, 4);
    return list.length
      ? `<ul class="signal-list">${list.map((x) => `<li>${truncateWords(x, 12)}</li>`).join("")}</ul>`
      : '<p class="muted">-</p>';
  };

  const nextRows = (a.nextSteps || [])
    .filter((row) => !isUnknown(row.action))
    .map(
      (row) => `<tr class="${row.isRisk ? "risk-row" : ""}">
        <td>${truncateWords(row.owner, 8)}</td>
        <td>${row.isRisk ? '<span class="risk-flag">⚠</span> ' : ""}${truncateWords(row.action, 8)}</td>
        <td>${truncateWords(row.due, 8)}</td>
        <td>${truncateWords(row.why, 14)}</td>
      </tr>`,
    )
    .join("");

  const nextTable = nextRows
    ? `<table class="next-steps-table">
        <thead><tr><th>Owner</th><th>Action</th><th>Due</th><th>Why</th></tr></thead>
        <tbody>${nextRows}</tbody>
      </table>`
    : '<p class="muted">-</p>';

  const followUpEmail = arts.suggestedFollowUpEmail?.subject || arts.suggestedFollowUpEmail?.body
    ? `<details class="sources email-sources">
        <summary>Follow-up email</summary>
        <div class="email-draft">
          <p><strong>Subject:</strong> ${esc(arts.suggestedFollowUpEmail?.subject)}</p>
          <pre>${esc(arts.suggestedFollowUpEmail?.body)}</pre>
        </div>
      </details>`
    : "";

  const crmBlock = arts.crmNotes && !isUnknown(arts.crmNotes)
    ? `<details class="sources crm-sources"><summary>CRM notes</summary><p class="crm-notes">${esc(arts.crmNotes)}</p></details>`
    : "";

  const callNotes = a.callNotes && !isUnknown(a.callNotes)
    ? `<section class="call-notes-section">
        <h2>Call notes</h2>
        <p class="muted call-notes-hint">Internal: blunt coaching narrative. Not the customer MoM.</p>
        <div class="call-notes-body">${esc(a.callNotes)}</div>
      </section>`
    : "";

  const momDraft = data.summarise?.momDraft || data.momDraft;
  const momBody = momDraft?.editedBody || momDraft?.draftBody || "";
  const momBlock = momBody && !isUnknown(momBody)
    ? `<section class="mom-draft-section">
        <h2>Minutes draft</h2>
        <p class="muted mom-hint">Customer-facing: edit before send. Never auto-sent.${
          momDraft?.sentAt
            ? ` Sent ${esc(new Date(momDraft.sentAt).toLocaleString())}.`
            : " Not sent yet."
        }</p>
        <div class="mom-draft-body">${esc(momBody)}</div>
      </section>`
    : "";

  const followUps = data.summarise?.followUps || data.followUps || [];
  const followUpCollectionRows = followUps
    .filter((f) => f?.description && !isUnknown(f.description))
    .map(
      (f) => `<tr>
        <td>${esc(f.owner || "se")}</td>
        <td>${truncateWords(f.description, 25)}</td>
        <td>${truncateWords(f.dueDate || "-", 8)}</td>
        <td>${esc(f.status || "open")}</td>
      </tr>`,
    )
    .join("");
  const followUpCollectionBlock = followUpCollectionRows
    ? `<section class="follow-ups-section">
        <h2>Commitments</h2>
        <table class="next-steps-table">
          <thead><tr><th>Owner</th><th>Description</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>${followUpCollectionRows}</tbody>
        </table>
      </section>`
    : "";

  const objections = data.summarise?.objections || data.objections || [];
  const objectionRows = objections
    .filter((o) => o?.objectionText && !isUnknown(o.objectionText))
    .map(
      (o) => `<tr class="${o.landed ? "" : "risk-row"}">
        <td>${truncateWords(o.objectionText, 30)}</td>
        <td>${truncateWords(o.handling || "-", 30)}</td>
        <td>${o.landed ? "Landed" : "Open"}</td>
        <td>${esc(o.theme || "-")}</td>
      </tr>`,
    )
    .join("");
  const objectionsBlock = objectionRows
    ? `<section class="objections-section">
        <h2>Objections</h2>
        <table class="next-steps-table">
          <thead><tr><th>Objection</th><th>Handling</th><th>Landed</th><th>Theme</th></tr></thead>
          <tbody>${objectionRows}</tbody>
        </table>
      </section>`
    : "";

  const transcriptDetails = tm.wordCount || tm.durationMinutes != null || (tm.speakers || []).length
    ? `<details class="sources transcript-sources">
        <summary>Transcript</summary>
        <ul>
          ${tm.durationMinutes != null ? `<li>Duration: ~${esc(tm.durationMinutes)} min</li>` : ""}
          ${tm.wordCount ? `<li>Word count: ${esc(tm.wordCount)}</li>` : ""}
          ${tm.speakerCount ? `<li>Speakers: ${esc(tm.speakerCount)}</li>` : ""}
          ${(tm.speakers || []).length ? `<li>Names: ${(tm.speakers || []).map(esc).join(", ")}</li>` : ""}
        </ul>
      </details>`
    : "";

  const momCls = momentumClass(mom.status);

  const momentumHero = `<section class="outcome-bar outcome-focal momentum-hero ${momCls}">
    <div class="outcome-status">
      <span class="outcome-arrow" aria-hidden="true">${momentumArrow(mom.status)}</span>
      <span class="outcome-label">${esc(mom.status || "Stalled")}</span>
    </div>
    <p class="outcome-reason">${truncateWords(mom.reason, 18)}</p>
    <div class="outcome-action">
      <strong>Top action:</strong> ${truncateWords(mom.topAction, 8)}
      ${!isUnknown(mom.topActionDue) ? ` · <span class="muted">Due ${truncateWords(mom.topActionDue, 8)}</span>` : ""}
    </div>
  </section>`;

  return `
    <div class="toolbar">
      <fw-button id="toolbar-print" color="secondary" fill="outline">Print / PDF</fw-button>
      <fw-button id="copy-postcall-json" color="secondary" fill="outline">Copy JSON</fw-button>
      <fw-button id="copy-followup" color="secondary" fill="outline">Copy follow-up email</fw-button>
    </div>
    <header class="header-strip">
      <div class="header-main">
        <h2 class="one-pager-title">${esc(getCallTitle(a, meta))}</h2>
        ${metaLine ? `<span class="header-meta">${metaLine}</span>` : ""}
      </div>
      <div class="attendee-chips">${attendeeChips}</div>
    </header>
    ${momentumHero}
    <section class="prep-hero"><h2>This call → Follow-up</h2>${followTable}</section>
    <section class="signals-row">
      <h2>Signals</h2>
      <div class="signals-grid">
        <div class="signal-col signal-pains"><h3>Pains confirmed</h3>${signalCol(sig.painsConfirmed)}</div>
        <div class="signal-col signal-objections"><h3>Objections open</h3>${signalCol(sig.objectionsOpen)}</div>
        <div class="signal-col signal-competitors"><h3>Competitors</h3>${signalCol(sig.competitors)}</div>
      </div>
    </section>
    <section class="next-steps-section"><h2>Next steps</h2>${nextTable}</section>
    ${followUpCollectionBlock}
    ${objectionsBlock}
    ${callNotes}
    ${momBlock}
    <section class="qip-section-wrap">
      <h2>${useQip ? "QIP scorecard" : "Quality coach"}</h2>
      ${
        useQip
          ? renderQipScorecard(scorecard || { lines: [] }, data.analysisMeta || {})
          : renderQualityCoach(a.qualityCoach)
      }
    </section>
    <footer class="prep-footer">${followUpEmail}${crmBlock}${transcriptDetails}</footer>`;
}

/** Keep the inline one-pager hidden once a call record exists. */
export function hidePostCallLegacyResult() {
  const result = $("postcall-result");
  if (result) {
    result.classList.remove("anim-root", "anim-ready");
    show(result, false);
  }
}

/** Route to the call-record view. never leave the legacy one-pager visible. */
function navigateToCallRecord(recordId) {
  if (!recordId) return;
  hidePostCallLegacyResult();
  show($("postcall-form-view"), false);
  show($("postcall-confirm-view"), false);
  show($("postcall-loading"), false);
  void hidePostCallGenOverlay();
  if (typeof onCallRecordReady === "function") {
    onCallRecordReady(recordId);
  }
  window.dispatchEvent(
    new CustomEvent("lionpath:open-call-record", { detail: { id: recordId }, bubbles: true }),
  );
  if (!location.hash.includes(recordId)) {
    location.hash = `#calls/${recordId}`;
  }
}

export function displayPostCall(data, meta) {
  if (pipelineState?.recordId || pipelineState?.generated) {
    hidePostCallLegacyResult();
    return;
  }
  const result = $("postcall-result");
  if (!result) return;
  result.classList.remove("anim-root", "anim-ready");
  try {
    const confirmedBanner = renderConfirmedReadOnlyBanner(data);
    result.innerHTML = confirmedBanner + renderPostCall(data, meta);
  } catch (err) {
    console.error("[postcall] render failed:", err);
    result.innerHTML = `<fw-inline-message type="error" open closable="false">${esc(err.message || "Could not render analysis.")}</fw-inline-message>`;
  }
  wirePostCallNavigation(result, data);
  show($("postcall-form-view"), false);
  show(result, true);
  initPostCallAnimations(result);
  wirePrintToolbar(result);
  wireToolbarById(result, {
    "copy-postcall-json": () => navigator.clipboard.writeText(JSON.stringify(data, null, 2)),
    "copy-followup": () => {
      const e = data.analysis?.artifacts?.suggestedFollowUpEmail
        || data.analysis?.nextSteps?.suggestedFollowUpEmail;
      if (e) navigator.clipboard.writeText(`Subject: ${e.subject}\n\n${e.body}`);
    },
  });
  result.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function wirePostCallNavigation(root, data) {
  if (!root) return;
  const accountId = data?.resolve?.account?.accountId || data?.confirmed?.accountId || null;
  const dealId =
    data?.confirmed?.dealId ||
    data?.resolve?.deals?.find((d) => d.preselected)?.dealId ||
    data?.resolve?.deals?.[0]?.dealId ||
    null;
  root.querySelectorAll('[data-postcall-nav="account"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!accountId) return;
      e.preventDefault();
      location.hash = `#accounts/${accountId}`;
    });
  });
  root.querySelectorAll('[data-postcall-nav="deal"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!dealId) return;
      e.preventDefault();
      location.hash = `#deals/${dealId}`;
    });
  });
}

let onAnalysisSaved = null;
/** @type {((id: string) => void) | null} */
let onCallRecordReady = null;
/** @type {((id: string) => void) | null} */
let onCallRecordHydrated = null;

/** @param {(record: object) => void} fn */
export function setOnAnalysisSaved(fn) {
  onAnalysisSaved = fn;
}

/** @param {(id: string) => void} fn */
export function setOnCallRecordReady(fn) {
  onCallRecordReady = fn;
}

/** @param {(id: string) => void} fn */
export function setOnCallRecordHydrated(fn) {
  onCallRecordHydrated = fn;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function showPostCallPipeline(steps, detail) {
  if ($("postcall-confirm-view") && !$("postcall-confirm-view").hidden) {
    hidePipelineProgress("postcall-progress");
    return;
  }
  showPipelineProgress("postcall-progress", steps, {
    title: "Call analysis",
    meta: detail,
  });
  if (isGenOverlayActive()) {
    const active = steps.find((s) => s.status === "active");
    updatePrepGenOverlay({
      message: detail || active?.label || `${POSTCALL_GEN_THEME.title}…`,
      pct: Math.max(prepStepsToPct(steps), 8),
    });
  }
}

function showPostCallGenOverlay(message, pct = 8) {
  show($("postcall-loading"), false);
  showPrepGenOverlay({
    theme: POSTCALL_GEN_THEME,
    message: message || `${POSTCALL_GEN_THEME.title}…`,
    pct,
  });
}

function hidePostCallGenOverlay(onHidden) {
  return hidePrepGenOverlay(onHidden);
}

function formatMatchReasons(reasons) {
  if (!reasons?.length) return '<span class="muted">No match signals</span>';
  return `<ul class="postcall-match-reasons">${reasons
    .map((r) => `<li><span class="postcall-match-rank">#${esc(r.rank)}</span> ${esc(r.detail)}</li>`)
    .join("")}</ul>`;
}

function matchConfidencePill(score) {
  if (score == null || !Number.isFinite(Number(score))) return "";
  const pct = Math.round(Number(score) * 100);
  if (pct >= 80) return '<span class="pill green">Confident</span>';
  if (pct >= 50) return `<span class="pill amber">${esc(String(pct))}% sure</span>`;
  return `<span class="pill red">${esc(String(pct))}% match</span>`;
}

function formatDurationMinutes(mins) {
  if (mins == null || !Number.isFinite(Number(mins))) return "-";
  const n = Number(mins);
  if (n < 1) return "< 1 min";
  return `${Math.round(n * 10) / 10} min`;
}

function isInternalIdentity(label) {
  return /@(?:freshworks|freshdesk|freshservice)\./i.test(String(label || ""));
}

function looksLikeAeIdentity(label) {
  const s = String(label || "");
  if (/\|\s*ae\b/i.test(s) || /\bae\s*@/i.test(s)) return true;
  return /(?:^|[\s|,/(-])(ae|a\.e\.|account\s*exec(?:utive)?|account\s*manager|sales\s*rep|sdr|bdr)(?:$|[\s|,/)-])/i.test(
    s,
  );
}

function looksLikeSeIdentity(label) {
  const s = String(label || "");
  if (looksLikeAeIdentity(s)) return false;
  if (/\|\s*se\b/i.test(s)) return true;
  return /(?:^|[\s|,/(-])(se|s\.e\.|solutions?\s*engineer|solutions?\s*consultant|sales\s*engineer|pre[- ]?sales)(?:$|[\s|,/)-])/i.test(
    s,
  );
}

function nextConfirmRole(role) {
  const idx = CONFIRM_ROLE_SET.indexOf(role);
  return CONFIRM_ROLE_SET[(idx + 1) % CONFIRM_ROLE_SET.length];
}

function personInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function personMonoTone(label, role) {
  if (role === "Customer" || role === "Partner") {
    return { bg: "#f6e7e1", color: "#c2603f" };
  }
  return { bg: "#e3efec", color: "#2e897b" };
}

function parseAttendeeIdentity(label) {
  const raw = String(label || "").trim();
  const emailMatch = raw.match(/[^\s,]+@[^\s,]+/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : "";
  let name = raw.replace(/\([^)]*\)/g, " ").replace(/\|.*$/, "").trim();
  if (email && name.toLowerCase().includes(email.toLowerCase())) {
    name = name.replace(email, "").trim();
  }
  if (!name && email) name = email.split("@")[0].replace(/[._-]+/g, " ");
  return { name: name || raw || "Attendee", email: email || null, label: raw || name || email };
}

function inferAttendeeRole(label, resolve, sessionLabel) {
  const sessionKey = normalizePersonKey(sessionLabel);
  const key = normalizePersonKey(label);
  if (sessionKey && key && sessionKey === key) return "Primary SE";
  if (looksLikeAeIdentity(label)) return "AE";
  if (looksLikeSeIdentity(label)) return "Secondary SE";
  if (isInternalIdentity(label)) {
    return normalizePersonKey(resolve?.seIdentity) === key ? "Primary SE" : "Secondary SE";
  }
  const customers = (resolve?.customerIdentities || []).map(normalizePersonKey);
  if (customers.includes(key)) return "Customer";
  return "Customer";
}

function contactsForIdentityMerge(resolve) {
  /** @type {object[]} */
  const contacts = [];
  for (const email of resolve?.participantEmails || []) {
    contacts.push({ email });
  }
  for (const entry of lastCrmMatchResult?.byEmail || []) {
    if (entry?.contact) {
      contacts.push({
        name: entry.contact.name || entry.contact.label || "",
        email: entry.contact.email || entry.email,
        label: entry.contact.label || entry.contact.name || "",
      });
    }
  }
  return contacts;
}

/** @param {object} resolve */
export function buildConfirmAttendees(resolve) {
  const speakers = resolve?.transcriptMeta?.speakers || [];
  const emails = resolve?.participantEmails || [];
  const fromResolve = resolve?.identityOptions || [];
  const contacts = contactsForIdentityMerge(resolve);
  const sessionLabel =
    currentSession?.name || currentSession?.displayName || currentSession?.email || "se@freshworks.com";
  const labels = dedupePersonLabels([
    sessionLabel,
    resolve?.seIdentity,
    resolve?.aeIdentity,
    ...(resolve?.customerIdentities || []),
    ...fromResolve,
    ...speakers,
  ]).filter(Boolean);

  const candidates = labels.map((label) => {
    const parsed = parseAttendeeIdentity(label);
    const role = inferAttendeeRole(label, resolve, sessionLabel);
    return {
      id: normalizePersonKey(label),
      name: parsed.name,
      email: parsed.email,
      label: parsed.label,
      detail: parsed.email || parsed.label,
      role,
      manual: false,
    };
  });

  for (const email of emails) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) continue;
    const parsed = parseAttendeeIdentity(normalized);
    candidates.push({
      id: normalizePersonKey(normalized),
      name: parsed.name,
      email: parsed.email,
      label: parsed.label,
      detail: parsed.email || parsed.label,
      role: inferAttendeeRole(normalized, resolve, sessionLabel),
      manual: false,
    });
  }

  let merged = mergeCallIdentities(candidates, contacts, speakers);

  const sessionKey = normalizePersonKey(sessionLabel);
  if (sessionKey) {
    const sessionParsed = parseAttendeeIdentity(sessionLabel);
    const existing = merged.find(
      (a) =>
        normalizePersonKey(a.name) === sessionKey ||
        normalizePersonKey(a.email) === sessionKey ||
        normalizePersonKey(a.label) === sessionKey,
    );
    if (existing) {
      existing.role = "Primary SE";
      if (!existing.email && sessionParsed.email) existing.email = sessionParsed.email;
    } else {
      merged.push({
        id: sessionKey,
        name: sessionParsed.name,
        email: sessionParsed.email || "se@freshworks.com",
        label: sessionLabel,
        detail: sessionParsed.email || sessionLabel,
        role: "Primary SE",
        manual: false,
      });
    }
  }

  let primarySeen = false;
  for (const att of merged) {
    if (att.role === "Primary SE") {
      if (primarySeen) att.role = "Secondary SE";
      primarySeen = true;
    }
  }

  return merged.map((att) => {
    const mono = personMonoTone(att.name, att.role);
    return {
      ...att,
      detail: att.email || att.detail || att.label,
      monoBg: mono.bg,
      monoColor: mono.color,
    };
  });
}

function renderRoleSelect(role, index) {
  const options = CONFIRM_ROLE_SET.map(
    (r) => `<option value="${esc(r)}"${r === role ? " selected" : ""}>${esc(r)}</option>`,
  ).join("");
  return `<select class="postcall-role-select" data-attendee-index="${index}" aria-label="Role for attendee">${options}</select>`;
}

function renderConfirmAccountDealShowcase(account, selectedDeal, resolve) {
  const formCompany = pipelineState?.payload?.companyName || "";
  const suggestedName = resolve?.noMatch?.suggestedCompanyName || formCompany || "";
  const displayName = titleCaseDisplayName(account?.accountName || suggestedName || "Account");
  const intakeAccount = getIntakeAccountSelection();
  const accountBadge = account?.accountId
    ? "Existing account"
    : "New account · on confirm";
  const intakeDeal = getIntakeDealSelection();
  const dealTitle = selectedDeal
    ? titleCaseDisplayName(selectedDeal.title)
    : intakeDeal.createNewDeal && intakeDeal.newDealTitle
      ? titleCaseDisplayName(intakeDeal.newDealTitle)
      : account
        ? titleCaseDisplayName(intakeDeal.newDealTitle) ||
          formatDealTitlePreview(displayName, intakeDeal.newDealType)
        : "No deal yet";
  const dealStage = selectedDeal
    ? STAGE_LABELS[selectedDeal.stage] || selectedDeal.stage || ""
    : account && (intakeDeal.createNewDeal || !selectedDeal)
      ? "Create on confirm"
      : "";

  const editBlock = "";

  const showDealPicker =
    !intakeAccount.createNewAccount &&
    !intakeDeal.createNewDeal &&
    !intakeDeal.selectedDealId &&
    (resolve?.deals?.length || 0) > 1;
  const dealPicker = showDealPicker
      ? `<div class="postcall-deal-picker-inline">
          <span class="nb-label">Pick deal</span>
          <div class="postcall-deal-list">${resolve.deals
            .map((d) => {
              const checked = d.dealId === (selectedDeal?.dealId || "") ? " checked" : "";
              return `<label class="postcall-deal-option postcall-deal-option--compact">
                <input type="radio" name="postcall-deal" value="${esc(d.dealId)}"${checked} />
                <span>${esc(titleCaseDisplayName(d.title))}</span>
              </label>`;
            })
            .join("")}</div>
        </div>`
      : "";

  return `<div class="nb-account-deal-grid postcall-confirm-showcase">
      <div class="nb-account-column">
        <span class="nb-label">Account</span>
        <div class="nb-account-slot">
          <div class="nb-account-card prep-account-card" aria-live="polite">
            <span class="nb-account-card-mono">${esc(companyMono(displayName))}</span>
            <div class="nb-account-card-body">
              <span class="nb-account-card-name">${esc(displayName)}</span>
              <span class="nb-account-card-badge">${esc(accountBadge)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="nb-deal-slot">
        <div class="nb-deal-head"><span class="nb-label">Deal</span></div>
        <div class="nb-deal-card prep-deal-card">
          <span class="nb-deal-card-icon" aria-hidden="true">◆</span>
          <div class="nb-deal-card-body">
            <span class="nb-deal-card-title">${esc(dealTitle)}</span>
            ${dealStage ? `<span class="nb-deal-card-stage">${esc(dealStage)}</span>` : ""}
          </div>
        </div>
      </div>
      ${editBlock}
      ${dealPicker}
    </div>`;
}

function renderAttendeeRow(att, index) {
  const editable = att.manual;
  const body = editable
    ? `<input type="text" class="postcall-confirm-input postcall-attendee-name" placeholder="Name" value="${esc(att.name === "Attendee" ? "" : att.name)}" />
       <div class="pc-lookup-field postcall-attendee-lookup">
         <input type="email" class="postcall-confirm-input postcall-attendee-email" placeholder="Email" value="${esc(att.email || "")}" autocomplete="off" />
         <div class="pc-lookup-menu postcall-contact-suggest" role="listbox" hidden></div>
       </div>`
    : `<div class="postcall-attendee-text">
         <span class="postcall-attendee-name">${esc(att.name)}</span>
         <span class="postcall-attendee-detail muted">${esc(att.detail || "")}</span>
       </div>`;

  return `<div class="postcall-attendee-row${editable ? " postcall-attendee-row--manual" : ""}" data-attendee-index="${index}"${!editable ? ` data-name="${esc(att.name)}" data-email="${esc(att.email || "")}"` : ""}>
    <span class="postcall-attendee-avatar" style="background:${esc(att.monoBg)};color:${esc(att.monoColor)}">${esc(personInitials(att.name))}</span>
    <div class="postcall-attendee-body">${body}</div>
    ${renderRoleSelect(att.role, index)}
    ${editable ? `<button type="button" class="postcall-attendee-remove" data-attendee-index="${index}" aria-label="Remove attendee">×</button>` : ""}
  </div>`;
}

function renderAttendeesSection(attendees) {
  return `<div class="postcall-confirm-block postcall-attendees-block">
    <div class="postcall-section-head">
      <h3>Who was on the call</h3>
      <span class="postcall-ai-badge"><span class="postcall-ai-dot" aria-hidden="true"></span>AI detected</span>
    </div>
    <p class="muted postcall-attendee-hint">Assign a role to each person on the call.</p>
    <div id="postcall-attendee-list" class="postcall-attendee-list">${attendees.map(renderAttendeeRow).join("")}</div>
    <button type="button" id="postcall-add-attendee-btn" class="postcall-add-attendee">＋ Add attendee</button>
  </div>`;
}

function renderCallTypeChips(selected, confidencePct) {
  const selectedType = selected || "discovery";
  const chips = CALL_TYPES.map((t) => {
    const isSel = t === selectedType;
    const label = CALL_TYPE_LABELS[t] || t;
    const cls = isSel ? " postcall-call-type-chip is-selected" : " postcall-call-type-chip";
    return `<button type="button" class="${cls.trim()}" data-call-type="${esc(t)}" aria-pressed="${isSel ? "true" : "false"}">${esc(label)}</button>`;
  }).join("");
  const pill =
    confidencePct >= 80
      ? '<span class="pill green">Confident</span>'
      : `<span class="pill amber">${esc(String(confidencePct))}% sure</span>`;
  return `<div class="postcall-confirm-block postcall-calltype-block">
    <div class="postcall-section-head">
      <h3>Call type</h3>
      <span class="postcall-ai-badge"><span class="postcall-ai-dot" aria-hidden="true"></span>AI detected</span>
      ${pill}
    </div>
    <div class="postcall-call-type-chips" role="group" aria-label="Call type">${chips}</div>
    <input type="hidden" id="pc-confirm-call-type" value="${esc(selectedType)}" />
  </div>`;
}

function renderConfirmTopCard(resolve, account, selectedDeal) {
  return renderConfirmAccountDealShowcase(account, selectedDeal, resolve);
}

function renderVideoThemeWarning(_resolve) {
  return "";
}

export function renderConfirmationGate(resolve, classify) {
  const account = resolveConfirmAccount(resolve);
  const selectedDeal = resolveConfirmSelectedDeal(resolve?.deals || []);
  const callType = classify?.primary || "discovery";
  const confidencePct = Math.round((classify?.confidence ?? 0) * 100);
  confirmGateAttendees = buildConfirmAttendees(resolve);

  const dealOptions = "";

  const freeMailBlock = resolve?.needsCompanyDomain
    ? `<div class="postcall-confirm-block">
        <h3>Company domain required</h3>
        <p class="muted">Participant email uses a personal domain (${esc((resolve.freeMailDomains || []).join(", "))}). Enter the real company domain.</p>
        <label for="pc-confirm-domain">Company domain</label>
        <input id="pc-confirm-domain" class="postcall-confirm-input" type="text" placeholder="acme.com" required />
      </div>`
    : "";

  return `
    <header class="postcall-confirm-header">
      <h2>Confirm call details</h2>
    </header>
    ${renderConfirmTopCard(resolve, account, selectedDeal)}
    ${dealOptions}
    ${renderCallTypeChips(callType, confidencePct)}
    ${renderAttendeesSection(confirmGateAttendees)}
    ${renderVideoThemeWarning(resolve)}
    ${freeMailBlock}
    <div class="postcall-confirm-actions">
      <fw-button id="postcall-confirm-btn" color="primary" class="prep-form-submit">Confirm and generate</fw-button>
      <fw-button id="postcall-restart-btn" color="secondary" fill="outline">Discard and start over</fw-button>
    </div>
    <p class="prep-form-footnote">Analysis usually finishes in 20–45 seconds after confirm.</p>`;
}

function syncAttendeeListDom(card) {
  const list = card?.querySelector("#postcall-attendee-list");
  if (!list || !confirmGateAttendees) return;
  list.innerHTML = confirmGateAttendees.map(renderAttendeeRow).join("");
  wireConfirmAttendeeRows(card);
}

function wireConfirmAttendeeRows(card) {
  confirmGateContactLookupTeardowns.forEach((fn) => fn());
  confirmGateContactLookupTeardowns = [];

  const accountId =
    pipelineState?.resolve?.account?.accountId ||
    pcResolvedAccount?.id ||
    pipelineState?.payload?.accountId ||
    null;

  card.querySelectorAll(".postcall-attendee-row--manual").forEach((row) => {
    const emailInput = row.querySelector(".postcall-attendee-email");
    const menu = row.querySelector(".postcall-contact-suggest");
    const nameInput = row.querySelector(".postcall-attendee-name");
    if (!emailInput || !menu) return;
    const teardown = attachContactLookup({
      inputEl: emailInput,
      menuEl: menu,
      accountId,
      onPick: (contact) => {
        if (contact.email) emailInput.value = contact.email;
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = contact.label || "";
        }
      },
    });
    if (teardown) confirmGateContactLookupTeardowns.push(teardown);
  });

  card.querySelectorAll(".postcall-role-select").forEach((select) => {
    select.addEventListener("change", () => {
      const idx = Number(select.dataset.attendeeIndex);
      const att = confirmGateAttendees?.[idx];
      if (!att) return;
      const nextRole = select.value || "Customer";
      att.role = nextRole;
      if (nextRole === "Primary SE") {
        confirmGateAttendees.forEach((a, i) => {
          if (i !== idx && a.role === "Primary SE") a.role = "Secondary SE";
        });
        syncAttendeeListDom(card);
      }
    });
  });

  card.querySelectorAll(".postcall-attendee-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.attendeeIndex);
      if (!confirmGateAttendees || idx < 0) return;
      confirmGateAttendees.splice(idx, 1);
      syncAttendeeListDom(card);
    });
  });
}

function wireConfirmGateInteractions(card) {
  wireConfirmAttendeeRows(card);

  card.querySelectorAll(".postcall-call-type-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      card.querySelectorAll(".postcall-call-type-chip").forEach((c) => {
        c.classList.remove("is-selected");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("is-selected");
      chip.setAttribute("aria-pressed", "true");
      const hidden = card.querySelector("#pc-confirm-call-type");
      if (hidden) hidden.value = chip.dataset.callType || "discovery";
    });
  });

  const addBtn = card.querySelector("#postcall-add-attendee-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (!confirmGateAttendees) confirmGateAttendees = [];
      const mono = personMonoTone("", "Customer");
      confirmGateAttendees.push({
        id: `manual_${Date.now()}`,
        name: "",
        email: "",
        detail: "",
        role: "Customer",
        manual: true,
        monoBg: mono.bg,
        monoColor: mono.color,
      });
      syncAttendeeListDom(card);
    });
  }
}

function showConfirmationGate(resolve, classify) {
  import("./domain/store.js").catch(() => {});
  import("./domain/arr-service.js").catch(() => {});

  hidePipelineProgress("postcall-progress");
  void hidePostCallGenOverlay();

  const card = $("postcall-confirm-view");
  if (!card) return;
  card.innerHTML = renderConfirmationGate(resolve, classify);
  show($("postcall-form-view"), false);
  show($("postcall-loading"), false);
  show(card, true);
  show($("postcall-result"), false);

  bindActionOnce($("postcall-confirm-btn"), (e) => { void confirmAndGenerate(e); });
  bindActionOnce($("postcall-restart-btn"), (e) => { void restartPipeline(e); });

  confirmGateAccountLookupTeardown?.();
  confirmGateAccountLookupTeardown = null;
  confirmGateContactLookupTeardowns.forEach((fn) => fn());
  confirmGateContactLookupTeardowns = [];

  const confirmSearch = card.querySelector("#pc-confirm-search");
  const confirmSuggest = card.querySelector("#pc-confirm-suggest");
  const confirmAccount = card.querySelector("#pc-confirm-account");
  if (confirmSearch && confirmSuggest && confirmAccount) {
    confirmGateAccountLookupTeardown = attachAccountLookup({
      inputEl: confirmSearch,
      menuEl: confirmSuggest,
      onPick: (account, typedName) => {
        confirmAccount.value = typedName;
        pcDraftAccountName = typedName.trim();
        if (account) {
          pcResolvedAccount = {
            id: account.id,
            name: account.name,
            domain: account.domain || null,
          };
          pcCreateNewAccount = false;
        }
        wireConfirmAttendeeRows(card);
      },
    });
  }

  wireConfirmGateInteractions(card);

  card.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function readAttendeeSelections() {
  const rows = document.querySelectorAll(".postcall-attendee-row");
  /** @type {object[]} */
  const attendees = [];
  let seIdentity = "";
  let aeIdentity = "";
  /** @type {string[]} */
  const customerIdentities = [];
  /** @type {string[]} */
  const secondarySeIdentities = [];
  /** @type {string[]} */
  const partnerIdentities = [];

  rows.forEach((row) => {
    const nameInput = row.querySelector("input.postcall-attendee-name");
    const emailInput = row.querySelector("input.postcall-attendee-email");
    const name =
      (nameInput?.value || row.dataset.name || "").trim() ||
      (row.querySelector(".postcall-attendee-text .postcall-attendee-name")?.textContent || "").trim();
    const email =
      (emailInput?.value || row.dataset.email || "").trim() ||
      (row.querySelector(".postcall-attendee-detail")?.textContent || "").trim();
    const role = row.querySelector(".postcall-role-select")?.value || "Customer";
    const label = name || email;
    if (!label) return;
    attendees.push({ name, email, role, label });
    if (role === "Primary SE" && !seIdentity) seIdentity = label;
    else if (role === "Secondary SE") secondarySeIdentities.push(label);
    else if (role === "AE" && !aeIdentity) aeIdentity = label;
    else if (role === "Partner") partnerIdentities.push(label);
    else if (role === "Customer") customerIdentities.push(label);
  });

  const speakers = pipelineState?.resolve?.transcriptMeta?.speakers || [];
  const contacts = contactsForIdentityMerge(pipelineState?.resolve || {});
  const mergedAttendees = mergeCallIdentities(attendees, contacts, speakers);

  let se = seIdentity;
  let ae = aeIdentity;
  /** @type {string[]} */
  const customers = [];
  /** @type {string[]} */
  const secondarySes = [];
  /** @type {string[]} */
  const partners = [];

  for (const att of mergedAttendees) {
    const label = att.name || att.email || att.label;
    if (!label) continue;
    if (att.role === "Primary SE" && !se) se = label;
    else if (att.role === "Secondary SE") secondarySes.push(label);
    else if (att.role === "AE" && !ae) ae = label;
    else if (att.role === "Partner") partners.push(label);
    else if (att.role === "Customer") customers.push(label);
  }

  return {
    attendees: mergedAttendees,
    seIdentity: se,
    aeIdentity: ae,
    customerIdentities: customers,
    secondarySeIdentities: secondarySes,
    partnerIdentities: partners,
  };
}

function readConfirmationSelections() {
  const callTypeEl = $("pc-confirm-call-type");
  const callType = callTypeEl?.value || pipelineState?.classify?.primary || "discovery";
  const intakeDeal = getIntakeDealSelection();
  const dealRadio = document.querySelector('input[name="postcall-deal"]:checked');
  const dealId = intakeDeal.createNewDeal
    ? null
    : dealRadio?.value ||
      intakeDeal.selectedDealId ||
      pipelineState?.resolve?.deals?.find((d) => d.preselected)?.dealId ||
      pipelineState?.resolve?.deals?.[0]?.dealId ||
      null;
  const accountName = ($("pc-confirm-account")?.value || "").trim();
  const companyDomain = ($("pc-confirm-domain")?.value || "").trim().toLowerCase();
  const {
    attendees,
    seIdentity,
    aeIdentity,
    customerIdentities,
    secondarySeIdentities,
    partnerIdentities,
  } = readAttendeeSelections();
  return {
    callType,
    dealId,
    accountName,
    companyDomain,
    seIdentity,
    aeIdentity,
    customerIdentities,
    secondarySeIdentities,
    partnerIdentities,
    attendees,
  };
}

function formatConfirmedIdentitiesContext({
  seIdentity,
  aeIdentity,
  customerIdentities,
  secondarySeIdentities,
  partnerIdentities,
}) {
  const lines = ["Confirmed call identities (authoritative; use these for attendees/roles):"];
  if (seIdentity) lines.push(`- Primary SE: ${seIdentity}`);
  if (secondarySeIdentities?.length) {
    lines.push(`- Secondary SE: ${secondarySeIdentities.join(", ")}`);
  }
  if (aeIdentity) lines.push(`- AE: ${aeIdentity}`);
  if (customerIdentities?.length) {
    lines.push(`- Customer: ${customerIdentities.join(", ")}`);
  } else {
    lines.push("- Customer: (none selected)");
  }
  if (partnerIdentities?.length) {
    lines.push(`- Partner: ${partnerIdentities.join(", ")}`);
  }
  return lines.join("\n");
}

function stampGenerateQipVersions(data) {
  if (!data?.scorecard) return data;
  const rubric = effectiveRubricVersion(data.scorecard, data.analysisMeta || {});
  data.scorecard = { ...data.scorecard, rubricVersion: rubric };
  data.analysisMeta = { ...(data.analysisMeta || {}), rubricVersion: rubric };
  if (data.analysis) {
    data.analysis = { ...data.analysis, rubricVersion: rubric, analysisVersion: 2 };
  }
  return data;
}

async function confirmAndGenerate(e) {
  e?.preventDefault?.();
  if (generating) return;
  if (!pipelineState?.resolve || !pipelineState?.classify) return;

  const btn = $("postcall-confirm-btn");
  const status = $("postcall-status");
  const {
    callType,
    dealId,
    accountName,
    companyDomain,
    seIdentity,
    aeIdentity,
    customerIdentities,
    secondarySeIdentities,
    partnerIdentities,
    attendees,
  } = readConfirmationSelections();

  if (!seIdentity) {
    showInlineStatus(status, { type: "error", message: "Confirm who the Primary SE is before continuing." });
    return;
  }

  if (pipelineState.resolve.needsCompanyDomain && !companyDomain) {
    showInlineStatus(status, { type: "error", message: "Enter the real company domain before continuing." });
    return;
  }

  pipelineState.confirmedIdentities = {
    seIdentity,
    aeIdentity,
    customerIdentities,
    secondarySeIdentities,
    partnerIdentities,
    attendees,
  };

  const intakeAccount = getIntakeAccountSelection();
  const accountIdForContacts = intakeAccount.createNewAccount
    ? null
    : intakeAccount.accountId || pipelineState.payload.accountId || null;
  if (accountIdForContacts) {
    const actorId = (await postCallOwnerId()) || "system";
    for (const att of attendees) {
      if (att.role !== "Customer" || !att.email) continue;
      try {
        await ensureCustomerContact(
          accountIdForContacts,
          { name: att.name, email: att.email },
          { actorId, source: "postcall_confirm" },
        );
        // #region agent log
        console.warn(
          "[DBG-8a85ad]",
          JSON.stringify({
            hypothesisId: "H-CONTACTS-EARLY",
            accountId: accountIdForContacts,
            email: att.email ? "***" : null,
            source: "postcall_confirm",
          }),
        );
        // #endregion
      } catch (err) {
        console.warn("[postcall] ensure customer contact failed:", err?.message || err);
      }
    }
  }

  const classify = pipelineState.classify;
  const intakeDeal = getIntakeDealSelection();
  const preselectedId = pipelineState.resolve.deals?.find((d) => d.preselected)?.dealId || null;
  const callTypeOverride =
    callType !== classify.primary
      ? { from: classify.primary, to: callType, at: Date.now() }
      : undefined;
  const dealMatchOverride =
    dealId && preselectedId && dealId !== preselectedId
      ? { from: preselectedId, to: dealId, at: Date.now() }
      : undefined;

  generating = true;
  setButtonLoading(btn, true);
  show($("postcall-confirm-view"), false);
  showPostCallGenOverlay("Starting analysis…");

  const companyName =
    accountName ||
    pipelineState.payload.companyName ||
    pipelineState.resolve.account?.accountName;
  ensureIntakePayloadSynced({
    ...pipelineState.payload,
    companyName,
  });
  pipelineState.payload = { ...pipelineState.payload, companyName };
  const identityContext = formatConfirmedIdentitiesContext(
    pipelineState.confirmedIdentities || { seIdentity, aeIdentity, customerIdentities },
  );
  const additionalContext = [identityContext, pipelineState.payload.additionalContext]
    .filter(Boolean)
    .join("\n\n");
  const accountId = intakeAccount.createNewAccount
    ? null
    : intakeAccount.accountId || pipelineState.payload.accountId || null;
  const qualifyBody = {
    transcript: pipelineState.resolve.transcript,
    dealId: dealId || null,
    companyName,
    meetingTitle: pipelineState.payload.meetingTitle || companyName,
    callType,
    additionalContext,
    meetingDate: meetingDateFromResolve(pipelineState.resolve),
  };
  const summariseBody = {
    transcript: pipelineState.resolve.transcript,
    dealId: dealId || null,
    companyName,
    meetingTitle: pipelineState.payload.meetingTitle || companyName,
    callType,
    additionalContext,
    meetingDate: meetingDateFromResolve(pipelineState.resolve),
  };

  const qualifyP = postJson(QUALIFY_URL, qualifyBody).catch((err) => {
    console.warn("[postcall] qualify soft-fail:", err?.message || err);
    return null;
  });
  const summariseP = postJson(SUMMARISE_URL, summariseBody).catch((err) => {
    console.warn("[postcall] summarise soft-fail:", err?.message || err);
    return null;
  });
  const arrInputsP =
    dealId && accountId
      ? postJson(ARR_INPUTS_URL, {
          transcript: pipelineState.resolve.transcript,
          dealId,
          callId: pipelineState.recordId || null,
          companyName,
          meetingTitle: pipelineState.payload.meetingTitle || companyName,
          callType,
          additionalContext,
        }).catch((err) => {
          console.warn("[postcall] arr-inputs soft-fail:", err?.message || err);
          return null;
        })
      : Promise.resolve(null);
  const prevCommitP = dealId
    ? import("./domain/store.js")
        .then(({ getStore }) => {
          const store = getStore();
          return store.getTechnicalCommitByDeal
            ? store.getTechnicalCommitByDeal(dealId)
            : null;
        })
        .catch((err) => {
          console.warn("[postcall] prior technical commit lookup failed:", err?.message || err);
          return null;
        })
    : Promise.resolve(null);
  const allowanceP =
    dealId && accountId
      ? Promise.all([import("./domain/store.js"), import("./domain/arr-service.js")])
          .then(([{ getStore }, { accountAllowanceConsumedForDeal }]) =>
            accountAllowanceConsumedForDeal(getStore(), accountId, dealId),
          )
          .catch((err) => {
            console.warn("[postcall] allowance lookup failed:", err?.message || err);
            return null;
          })
      : Promise.resolve(null);
  const commitP = prevCommitP.then((previousCommit) =>
    postJson(COMMIT_URL, {
      ...qualifyBody,
      callId: pipelineState.recordId || null,
      previous: previousCommit,
    }).catch((err) => {
      console.warn("[postcall] commit soft-fail:", err?.message || err);
      return null;
    }),
  );

  let videoFacts = null;
  const pass2Transcript = pipelineState.resolve.transcript?.trim() || "";
  const pass2RecordingUrl = pipelineState.payload.recordingUrl?.trim() || "";
  const pass2DurationSec =
    pipelineState.resolve.media?.durationSec ??
    (pipelineState.resolve.durationMinutes != null
      ? Math.round(Number(pipelineState.resolve.durationMinutes) * 60)
      : null);
  const canRunPass2 =
    (pipelineState.resolve.videoAvailable && pass2RecordingUrl) || pass2Transcript.length > 0;

  if (canRunPass2) {
    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis + qualification + commitments", status: "active" },
    ]);
    const pass2UsesFfmpeg = pass2RecordingUrl.length > 0;
    showInlineStatus(status, {
      type: "info",
      message: pass2UsesFfmpeg
        ? "Sampling Zoom video for camera / share facts… (ffmpeg + vision on VPS)"
        : "Inferring slides and screen-share cues from transcript…",
      loading: true,
    });
    updatePrepGenOverlay({
      message: pass2UsesFfmpeg
        ? "Sampling Zoom video for camera and screen-share…"
        : "Inferring slides and screen-share cues from transcript…",
    });
    try {
      const provisionalCallId = `call_pending_${Date.now()}`;
      const videoRes = await postJson(VIDEO_PASS_URL, {
        callId: provisionalCallId,
        recordingUrl: pass2RecordingUrl || undefined,
        recordingPassword: pipelineState.payload.recordingPassword,
        // Do not pass resolve.media — Zoom signed URLs expire during the confirm gate.
        transcript: pass2Transcript || undefined,
        durationSec: pass2DurationSec,
        callType,
        visualAnalysisConsent: true,
        seIdentity,
        aeIdentity,
        customerIdentities,
      });
      videoFacts = videoRes?.videoFacts || null;
      pipelineState.videoFacts = videoFacts;
      pipelineState.pass2Debug = videoRes?.pass2Debug || null;
    } catch (videoErr) {
      const msg = videoErr?.message || String(videoErr);
      console.warn("[postcall] video-pass soft-fail:", msg);
      pipelineState.pass2Debug = { route: "unavailable", error: msg.slice(0, 200) };
      videoFacts = null;
    }
  } else {
    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis + qualification + commitments", status: "active" },
    ]);
  }

  showInlineStatus(status, {
    type: "info",
    message: "Generating analysis, qualification, and commitments… usually 15–40 seconds.",
    loading: true,
  });
  updatePrepGenOverlay({
    message: "Generating analysis, qualification, and commitments…",
  });

  try {
    const body = {
      transcript: pipelineState.resolve.transcript,
      recordingUrl: pipelineState.payload.recordingUrl,
      recordingPassword: pipelineState.payload.recordingPassword,
      companyName,
      prospectEmails: pipelineState.payload.prospectEmails,
      additionalContext,
      deckLink: pipelineState.payload.deckLink,
      linkedinProfileExports: pipelineState.payload.linkedinProfileExports,
      confirmed: true,
      callType,
      dealId,
      accountId,
      companyDomain: companyDomain || undefined,
      meetingDate: meetingDateFromResolve(pipelineState.resolve),
      resolveSnapshot: {
        ...pipelineState.resolve,
        seIdentity,
        aeIdentity,
        customerIdentities,
      },
      classifySnapshot: pipelineState.classify,
      callTypeOverride,
      dealMatchOverride,
      videoFacts: videoFacts || undefined,
    };

    const [data, qualify, commit, summarise] = await Promise.all([
      postJson(GENERATE_URL, body),
      qualifyP,
      commitP,
      summariseP,
    ]);
    if (qualify?.qualification) {
      data.qualification = qualify.qualification;
      data.framework = qualify.framework;
    }
    if (commit?.technicalCommit) {
      data.technicalCommit = commit.technicalCommit;
      data.tcDeltas = commit.tcDeltas || [];
    }
    if (summarise) {
      data.summarise = summarise;
      if (typeof summarise.callNotes === "string" && summarise.callNotes.trim()) {
        data.analysis = { ...(data.analysis || {}), callNotes: summarise.callNotes };
      }
    }
    stampGenerateQipVersions(data);

    pipelineState.generated = true;

    const meta = { title: "" };
    meta.title = getCallTitle(data.analysis, meta);
    hidePipelineProgress("postcall-progress");
    show($("postcall-loading"), false);
    updatePrepGenOverlay({ message: "Analysis ready", pct: 100 });
    await hidePostCallGenOverlay();
    showInlineStatus(status, { open: false });

    let record = null;
    const sessionEmail = normalizeUserEmail(currentSession?.email || getSession()?.email);
    if (sessionEmail) {
      const savePayload = {
        ...pipelineState.payload,
        dealId: intakeDeal.createNewDeal ? undefined : dealId,
        accountId: accountId || undefined,
        createNewDeal: intakeDeal.createNewDeal || undefined,
        newDealType: intakeDeal.createNewDeal ? intakeDeal.newDealType : undefined,
        newDealTitle: intakeDeal.createNewDeal
          ? intakeDeal.newDealTitle || defaultNewDealTitle(companyName)
          : undefined,
        callType,
        companyName,
        companyDomain:
          companyDomain ||
          pipelineState.payload.companyDomain ||
          domainFromEmail(pipelineState.payload.prospectEmails?.[0] || "") ||
          undefined,
        createNewAccount:
          pipelineState.payload.createNewAccount ||
          (!accountId && !!companyName) ||
          undefined,
        confirmedIdentities: pipelineState.confirmedIdentities || {
          seIdentity,
          aeIdentity,
          customerIdentities,
        },
      };
      record = await savePostCallHistory(sessionEmail, savePayload, {
        ...data,
        videoFacts: data.videoFacts || pipelineState.videoFacts || videoFacts || undefined,
        analysisMeta: {
          ...(data.analysisMeta || {}),
          pass2Debug: pipelineState.pass2Debug || data.analysisMeta?.pass2Debug || null,
        },
      });
      if (record?.id) {
        pipelineState.recordId = record.id;
        invalidatePostCallResolveContext();
        invalidateDealListCache();
        if (onAnalysisSaved) {
          try {
            await onAnalysisSaved(record, savePayload, data);
          } catch (err) {
            console.warn("[postcall] analysis-saved hook failed:", err?.message || err);
          }
        }
        const refreshed = getPostCallAnalysis(sessionEmail, record.id) || record;
        navigateToCallRecord(refreshed.id);
      }
    }

    // Call record is canonical after a successful generate — never show the legacy one-pager.
    if (pipelineState.generated) {
      hidePostCallLegacyResult();
      show($("postcall-form-view"), false);
      show($("postcall-confirm-view"), false);
      if (!record?.id) {
        console.warn("[postcall] generate succeeded but history save returned no record");
      }
    } else if (!record?.id) {
      displayPostCall(data, meta);
    }

    // Hydrate the slow passes after the SE is already looking at the analysis.
    void (async () => {
      try {
        if (!record?.id || !sessionEmail) return;

        const latest = getPostCallAnalysis(sessionEmail, record.id) || record;
        const effectiveDealId =
          latest.dealId ||
          latest.result?.confirmed?.dealId ||
          dealId ||
          null;
        const effectiveAccountId =
          latest.accountId ||
          latest.result?.confirmed?.accountId ||
          accountId ||
          null;

        let technicalCommit = data.technicalCommit || null;
        let tcDeltas = data.tcDeltas || [];

        if (effectiveDealId && !technicalCommit) {
          const prevCommit = await import("./domain/store.js")
            .then(({ getStore }) => {
              const store = getStore();
              return store.getTechnicalCommitByDeal
                ? store.getTechnicalCommitByDeal(effectiveDealId)
                : null;
            })
            .catch(() => null);
          const commitRes = await postJson(COMMIT_URL, {
            transcript: pipelineState.resolve.transcript,
            dealId: effectiveDealId,
            companyName,
            meetingTitle: pipelineState.payload.meetingTitle || companyName,
            callType,
            additionalContext,
            meetingDate: meetingDateFromResolve(pipelineState.resolve),
            callId: record.id,
            previous: prevCommit,
          }).catch((err) => {
            console.warn("[postcall] deferred commit soft-fail:", err?.message || err);
            return null;
          });
          if (commitRes?.technicalCommit) {
            technicalCommit = commitRes.technicalCommit;
            tcDeltas = commitRes.tcDeltas || [];
          }
        }

        let arrInputs = await arrInputsP;
        if (!arrInputs && effectiveDealId && effectiveAccountId) {
          arrInputs = await postJson(ARR_INPUTS_URL, {
            transcript: pipelineState.resolve.transcript,
            dealId: effectiveDealId,
            callId: record.id,
            companyName,
            meetingTitle: pipelineState.payload.meetingTitle || companyName,
            callType,
            additionalContext,
          }).catch((err) => {
            console.warn("[postcall] deferred arr-inputs soft-fail:", err?.message || err);
            return null;
          });
        }

        let arrCompute = null;
        if (arrInputs && effectiveDealId && effectiveAccountId) {
          const allowance = await Promise.all([
            import("./domain/store.js"),
            import("./domain/arr-service.js"),
          ])
            .then(([{ getStore }, { accountAllowanceConsumedForDeal }]) =>
              accountAllowanceConsumedForDeal(getStore(), effectiveAccountId, effectiveDealId),
            )
            .catch(() => null);
          arrCompute = await postJson(ARR_COMPUTE_URL, {
            ...arrInputs,
            accountAllowanceConsumed: allowance,
          }).catch((err) => {
            console.warn("[postcall] arr-compute soft-fail:", err?.message || err);
            return null;
          });
        }
        const arrPoint =
          arrCompute?.arrPoint ?? arrCompute?.arrEstimatePoint ?? null;
        const callNotes =
          typeof data.summarise?.callNotes === "string" ? data.summarise.callNotes.trim() : "";
        const gapsContext = [
          additionalContext,
          callNotes
            ? `Call notes (product gaps mentioned here MUST appear in productGaps when they describe missing product capability, SDKs, or integrations):\n${callNotes}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const pass6 = await postJson(GAPS_URL, {
          transcript: pipelineState.resolve.transcript,
          dealId: effectiveDealId,
          accountId: effectiveAccountId,
          companyName,
          meetingTitle: pipelineState.payload.meetingTitle || companyName,
          callType,
          arrSnapshot: arrPoint != null ? { arrEstimatePoint: arrPoint } : null,
          additionalContext: gapsContext || undefined,
        }).catch((err) => {
          console.warn("[postcall] pass6 gaps soft-fail:", err?.message || err);
          return null;
        });
        const timeline = await deriveCallTimeline({
          transcript: pipelineState.resolve.transcript,
          gaps: pass6?.productGaps || [],
          whatWorks: pass6?.whatWorks || [],
          objections: data.summarise?.objections || [],
          scorecardLines: data.scorecard?.lines || [],
        });
        const { updatePostCallAnalysis } = await import("./history.js");
        await updatePostCallAnalysis(sessionEmail, record.id, (rec) => {
          rec.pass6 = pass6 || rec.pass6 || null;
          if (effectiveDealId) rec.dealId = effectiveDealId;
          if (effectiveAccountId) rec.accountId = effectiveAccountId;
          rec.result = {
            ...(rec.result || {}),
            arrInputs,
            arrCompute,
            pass6,
            timeline,
            technicalCommit: technicalCommit || rec.result?.technicalCommit || null,
            tcDeltas: tcDeltas.length ? tcDeltas : rec.result?.tcDeltas || [],
            confirmed: {
              ...(rec.result?.confirmed || {}),
              dealId: effectiveDealId || rec.result?.confirmed?.dealId || null,
              accountId: effectiveAccountId || rec.result?.confirmed?.accountId || null,
            },
          };
          return rec;
        });
        onCallRecordHydrated?.(record.id);
      } catch (err) {
        console.warn("[postcall] background hydration failed:", err?.message || err);
      }
    })();
  } catch (err) {
    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis", status: "error" },
    ]);
    show($("postcall-confirm-view"), true);
    show($("postcall-loading"), false);
    void hidePostCallGenOverlay();
    showInlineStatus(status, { type: "error", message: err.message || "Generation failed." });
  } finally {
    setButtonLoading(btn, false);
    generating = false;
  }
}

function restartPipeline(e) {
  e?.preventDefault?.();
  if (generating) return;
  resetPostCallView();
}

const PC_TEXT_FIELD_IDS = [
  "pc-recording-url",
  "pc-recording-pwd",
  "pc-prospect-emails",
  "pc-deck-link",
  "pc-additional-context",
  "pc-transcript",
];

const PROSPECT_EMAIL_AUTOFILL_GUARD_MS = [0, 100, 300, 500];
const SESSION_EMAIL_IN_PROSPECT_MSG =
  "Your login email isn't a prospect contact — add customer attendee emails.";

function getNormalizedSessionEmail() {
  const email = currentSession?.email;
  return email ? String(email).trim().toLowerCase() : "";
}

/** @param {string} email @param {string} [sessionEmail] */
export function isSessionProspectEmail(email, sessionEmail = getNormalizedSessionEmail()) {
  if (!sessionEmail || !email) return false;
  return String(email).trim().toLowerCase() === sessionEmail;
}

/** @param {string[]} emails @param {string} [sessionEmail] */
export function filterSessionEmailFromProspects(emails, sessionEmail = getNormalizedSessionEmail()) {
  if (!sessionEmail) return emails;
  return emails.filter((e) => !isSessionProspectEmail(e, sessionEmail));
}

function configureProspectEmailShadowInput(el) {
  if (!el) return;
  const inner = el.shadowRoot?.querySelector("input, textarea");
  if (!inner) return;
  inner.setAttribute("autocomplete", "off");
  inner.setAttribute("autocapitalize", "off");
  inner.setAttribute("autocorrect", "off");
  inner.setAttribute("spellcheck", "false");
  inner.setAttribute("name", "pc-attendee-emails");
  inner.setAttribute("data-lpignore", "true");
  inner.setAttribute("data-1p-ignore", "true");
  inner.setAttribute("data-form-type", "other");
  inner.setAttribute("inputmode", "email");
  if (el.dataset.pcAutofillUnlocked !== "1") inner.readOnly = true;
}

function configureProspectEmailAntiAutofill(el) {
  if (!el) return;
  const apply = () => configureProspectEmailShadowInput(el);
  apply();
  if (typeof el.componentOnReady === "function") el.componentOnReady().then(apply);

  const unlock = () => {
    el.dataset.pcAutofillUnlocked = "1";
    const inner = el.shadowRoot?.querySelector("input, textarea");
    if (inner) inner.readOnly = false;
  };
  el.addEventListener("focus", unlock, true);
  el.addEventListener("fwFocus", unlock);

  const observer = new MutationObserver(apply);
  const observeRoot = () => {
    if (el.shadowRoot) observer.observe(el.shadowRoot, { childList: true });
    else requestAnimationFrame(observeRoot);
  };
  observeRoot();
}

async function rejectSessionEmailInProspectField(el) {
  if (!el) return false;
  const raw = await readFieldValueAsync(el);
  const sessionEmail = getNormalizedSessionEmail();
  if (!raw || !sessionEmail) return false;
  const parsed = parseProspectEmails(raw);
  const filtered = filterSessionEmailFromProspects(parsed, sessionEmail);
  if (filtered.length === parsed.length) return false;
  const next = filtered.join(", ");
  await setFieldValue(el, next);
  if (!next) clearFwInputField(el);
  else el.dispatchEvent(new CustomEvent("fwInput", { bubbles: true, detail: { value: next } }));
  setFieldError(el, SESSION_EMAIL_IN_PROSPECT_MSG);
  return true;
}

async function getProspectEmailsFromField() {
  const raw = await readFieldValueAsync($("pc-prospect-emails"));
  return filterSessionEmailFromProspects(parseProspectEmails(raw));
}

export function scheduleProspectEmailAutofillGuard() {
  for (const ms of PROSPECT_EMAIL_AUTOFILL_GUARD_MS) {
    window.setTimeout(() => { void ensurePostCallProspectEmailsEmpty(); }, ms);
  }
}

function clearFwInputField(el) {
  if (!el) return;
  try { el.value = ""; } catch { /* crayons guard */ }
  el.dispatchEvent(new CustomEvent("fwInput", { bubbles: true, detail: { value: "" } }));
  setFieldError(el);
}

/** Prospect emails must stay empty on load — never prefill the logged-in SE address. */
export async function ensurePostCallProspectEmailsEmpty() {
  const el = $("pc-prospect-emails");
  if (!el) return;

  if (el.dataset.pcAutofillUnlocked === "1") {
    await rejectSessionEmailInProspectField(el);
    return;
  }

  const current = await readFieldValueAsync(el);
  if (current) {
    const parsed = parseProspectEmails(current);
    const hadSessionEmail = parsed.some((e) => isSessionProspectEmail(e));
    await setFieldValue(el, "");
    clearFwInputField(el);
    if (hadSessionEmail) setFieldError(el, SESSION_EMAIL_IN_PROSPECT_MSG);
    return;
  }

  await setFieldValue(el, "");
  clearFwInputField(el);
  configureProspectEmailShadowInput(el);
}

/** Blank every post-call intake field so "New post call" starts genuinely empty. */
export function clearPostCallForm() {
  for (const id of PC_TEXT_FIELD_IDS) {
    clearFwInputField($(id));
  }

  const suggest = $("pc-company-suggest");
  if (suggest) { suggest.innerHTML = ""; suggest.hidden = true; }
  const note = $("pc-company-lookup-note");
  if (note) { note.textContent = ""; note.hidden = true; }
  const accountErr = $("pc-account-name-error");
  if (accountErr) { accountErr.textContent = ""; accountErr.hidden = true; }
  intakeAccountLookupTeardown?.();
  intakeAccountLookupTeardown = null;
  const crmMatches = $("pc-crm-matches");
  if (crmMatches) { crmMatches.innerHTML = ""; crmMatches.hidden = true; }
  const preview = $("pc-account-deal-preview");
  if (preview) { preview.innerHTML = ""; preview.hidden = true; }
  crmMatchesToken++;

  const fileInput = $("pc-transcript-file");
  if (fileInput) fileInput.value = "";
  const fileName = $("pc-transcript-file-name");
  if (fileName) fileName.hidden = true;
  const fileErr = $("pc-transcript-file-error");
  if (fileErr) fileErr.hidden = true;

  const fallback = $("pc-transcript-fallback");
  if (fallback) fallback.open = false;

  clearLinkedInAttachments("postcall");
  clearContextAttachments("postcall");
  const ctxList = $("pc-context-file-list");
  if (ctxList) ctxList.innerHTML = "";
  const ctxErr = $("pc-context-error");
  if (ctxErr) ctxErr.hidden = true;
  companyNameTouched = false;
  newDealTitleTouched = false;
  pcDraftAccountName = "";
  pcDraftNewDealTitle = "";
  pcResolvedAccount = null;
  pcCreateNewAccount = false;
  pcSelectedDealId = null;
  pcCreateNewDeal = false;
  pcNewDealType = "new_business";
  pcLastAccountDeals = [];
  const emailsEl = $("pc-prospect-emails");
  if (emailsEl) delete emailsEl.dataset.pcAutofillUnlocked;
  syncPasscodeVisibility();
}

/** Reset post-call UI for a fresh analysis (e.g. nav back from call record). */
export function resetPostCallView() {
  pipelineState = null;
  clearPostCallForm();
  void ensurePostCallProspectEmailsEmpty();
  scheduleProspectEmailAutofillGuard();
  show($("postcall-confirm-view"), false);
  show($("postcall-progress"), false);
  hidePipelineProgress("postcall-progress");
  show($("postcall-result"), false);
  show($("postcall-loading"), false);
  void hidePostCallGenOverlay();
  show($("postcall-form-view"), true);
  showInlineStatus($("postcall-status"), { open: false });
  setFormFieldsDisabled($("postcall-form"), false);
  setButtonLoading($("analyze-call"), false);
}

export function isPostCallGenerationBusy() {
  return generating || isGenOverlayActive();
}

async function collectIntakePayload() {
  const recordingField = $("pc-recording-url");
  const emailsField = $("pc-prospect-emails");
  const accountErr = $("pc-account-name-error");
  const { recordingUrl, recordingPassword } = parseRecordingInput(
    await readFieldValueAsync(recordingField),
    await readFieldValueAsync($("pc-recording-pwd")),
  );
  const companyName = await readAccountNameValue();
  const prospectEmailsRaw = (await readFieldValueAsync(emailsField))?.trim() || "";
  const allProspectEmails = parseProspectEmails(prospectEmailsRaw);
  const prospectEmails = filterSessionEmailFromProspects(allProspectEmails);
  const transcript = (await readFieldValueAsync($("pc-transcript")))?.trim() || "";
  const deckLink = (await readFieldValueAsync($("pc-deck-link")))?.trim() || undefined;
  const additionalContextRaw =
    (await readFieldValueAsync($("pc-additional-context")))?.trim() || undefined;
  const contextAttachments = contextAttachmentsForPayload("postcall");
  const additionalContext =
    mergeContextAttachments(additionalContextRaw, contextAttachments) || undefined;
  const linkedinProfileExports = linkedinProfileExportsForPayload("postcall");
  // SEs are obliged to visual analysis by policy — no per-call checkbox.
  // Kept in the payload because the worker (Pass 2 + scorecard camera_on) reads it.
  const visualAnalysisConsent = true;

  setFieldError(recordingField);
  setFieldError(emailsField);
  if (accountErr) {
    accountErr.hidden = true;
    accountErr.textContent = "";
  }

  if (!recordingUrl && !transcript) {
    const message = "Paste a Zoom/Kaia recording link, or a transcript below.";
    setFieldError(recordingField, message);
    return { error: message };
  }
  if (!companyName) {
    const message = "Enter an account name on the preview tile.";
    if (accountErr) {
      accountErr.textContent = message;
      accountErr.hidden = false;
    }
    const preview = $("pc-account-deal-preview");
    preview?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    return { error: message };
  }
  if (!prospectEmails.length) {
    const message = allProspectEmails.length
      ? SESSION_EMAIL_IN_PROSPECT_MSG
      : "Add at least one prospect email (comma separated).";
    setFieldError(emailsField, message);
    return { error: message };
  }

  const prospectDomain = domainFromEmail(prospectEmails[0] || "");
  const shouldCreateAccount =
    pcCreateNewAccount || (!pcResolvedAccount?.id && !!companyName);

  let newDealTitle =
    pcCreateNewDeal || !pcSelectedDealId ? pcDraftNewDealTitle.trim() : "";
  if ((pcCreateNewDeal || !pcSelectedDealId) && !newDealTitle) {
    newDealTitle = defaultNewDealTitle(companyName);
    pcDraftNewDealTitle = newDealTitle;
  }

  return {
    payload: {
      recordingUrl: recordingUrl || undefined,
      recordingPassword: recordingUrl ? recordingPassword : undefined,
      transcript: transcript || undefined,
      companyName,
      companyDomain: prospectDomain && !isFreeMailDomain(prospectDomain) ? prospectDomain : undefined,
      prospectEmails,
      participantEmails: prospectEmails,
      deckLink,
      additionalContext,
      contextAttachments,
      linkedinProfileExports,
      linkedinProfileExportsStored: linkedinProfileExportsForStorage("postcall"),
      visualAnalysisConsent,
      accountId: pcResolvedAccount?.id || undefined,
      createNewAccount: shouldCreateAccount || undefined,
      dealId: pcCreateNewDeal ? undefined : pcSelectedDealId || undefined,
      createNewDeal: pcCreateNewDeal || undefined,
      newDealType: pcCreateNewDeal || !pcSelectedDealId ? inferDealTypeFromTitle(newDealTitle) : undefined,
      newDealTitle: pcCreateNewDeal || !pcSelectedDealId ? newDealTitle || undefined : undefined,
    },
  };
}

function ensureIntakePayloadSynced(payload) {
  const intakeAccount = getIntakeAccountSelection();
  const intakeDeal = getIntakeDealSelection();
  if (intakeAccount.createNewAccount) {
    payload.createNewAccount = true;
    payload.accountId = undefined;
  }
  if (intakeDeal.createNewDeal) {
    payload.createNewDeal = true;
    payload.dealId = undefined;
    if (!intakeDeal.newDealTitle?.trim() && payload.companyName) {
      const title = defaultNewDealTitle(payload.companyName);
      pcDraftNewDealTitle = title;
      payload.newDealTitle = title;
      payload.newDealType = inferDealTypeFromTitle(title);
    } else if (intakeDeal.newDealTitle) {
      payload.newDealTitle = intakeDeal.newDealTitle;
      payload.newDealType = intakeDeal.newDealType;
    }
  }
  return payload;
}

async function startPipeline(e) {
  e?.preventDefault?.();
  if (linkedinParsing || contextParsing) return;
  const btn = $("analyze-call");
  const status = $("postcall-status");

  const collected = await collectIntakePayload();
  if (collected.error) {
    showInlineStatus(status, { type: "error", message: collected.error });
    return;
  }
  const { payload } = collected;
  pipelineState = { payload, resolve: null, classify: null, generated: false, recordId: null };

  setButtonLoading(btn, true);
  setFormFieldsDisabled($("postcall-form"), true);
  show($("postcall-result"), false);
  show($("postcall-confirm-view"), false);
  show($("postcall-loading"), false);
  showPostCallGenOverlay("Fetching transcript and matching account…");
  showPostCallPipeline([
    { label: "Resolve recording and match deal", status: "active" },
    { label: "Classify call type", status: "pending" },
    { label: "Generate analysis", status: "pending" },
  ]);
  showInlineStatus(status, {
    type: "info",
    message: "Fetching transcript and matching account…",
    loading: true,
  });

  try {
    const ownerId = (await postCallOwnerId()) || undefined;
    const domainContext = ownerId
      ? await buildPostCallResolveContext(ownerId, postCallResolveOpts())
      : { briefs: [], accounts: [], deals: [] };
    const resolve = await postJson(RESOLVE_URL, {
      transcript: payload.transcript,
      recordingUrl: payload.recordingUrl,
      recordingPassword: payload.recordingPassword,
      companyName: payload.companyName,
      meetingTitle: payload.companyName,
      participantEmails: payload.participantEmails,
      accountId: payload.accountId,
      ownerId,
      ownerEmail: currentSession?.email || undefined,
      ownerDisplayName: currentSession?.name || currentSession?.displayName || undefined,
      briefs: domainContext.briefs,
      accounts: domainContext.accounts,
      deals: domainContext.deals,
    });
    const accountIdForDeals =
      resolve?.account?.accountId ||
      getIntakeAccountSelection().accountId ||
      pcResolvedAccount?.id ||
      null;
    pipelineState.resolve = await enrichResolveDealsForAccount(resolve, accountIdForDeals, postCallResolveOpts());
    // Prefer form company when resolve did not match; keep for generate.
    if (!payload.companyName && pipelineState.resolve.account?.accountName) {
      payload.companyName = pipelineState.resolve.account.accountName;
    }

    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "active" },
      { label: "Generate analysis", status: "pending" },
    ]);
    showInlineStatus(status, {
      type: "info",
      message: "Classifying call type from transcript…",
      loading: true,
    });

    const classify = await postJson(CLASSIFY_URL, {
      transcript: pipelineState.resolve.transcript,
      meetingTitle: pipelineState.resolve.meetingTitle,
    });
    pipelineState.classify = classify;

    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis", status: "pending" },
    ]);
    showInlineStatus(status, { open: false });
    const intakeAccount = getIntakeAccountSelection();
    const dealsForConfirm = intakeAccount.createNewAccount
      ? []
      : (pipelineState.resolve.deals || []).filter(
          (d) =>
            !intakeAccount.accountId ||
            d.accountId === intakeAccount.accountId ||
            d.accountId === pipelineState.resolve.account?.accountId,
        );
    syncIntakeDealSelection(dealsForConfirm, {
      createNewDeal: pcCreateNewDeal || intakeAccount.createNewAccount || payload.createNewDeal,
      selectedDealId: pcSelectedDealId || payload.dealId,
    });
    ensureIntakePayloadSynced(payload);
    pipelineState.payload = payload;
    hidePipelineProgress("postcall-progress");
    await hidePostCallGenOverlay();
    showConfirmationGate(pipelineState.resolve, classify);
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    showPostCallPipeline([
      { label: "Resolve recording and match deal", status: "error" },
      { label: "Classify call type", status: "pending" },
      { label: "Generate analysis", status: "pending" },
    ]);
    void hidePostCallGenOverlay();
    if (msg === "Failed to fetch" || /^networkerror/i.test(msg) || /load failed/i.test(msg)) {
      showInlineStatus(status, {
        type: "error",
        message:
          `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
          "Start the worker in another terminal and refresh.",
      });
    } else {
      showInlineStatus(status, { type: "error", message: msg });
    }
    setFormFieldsDisabled($("postcall-form"), false);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function analyzeCall(e) {
  return startPipeline(e);
}

export function onSessionReady(session, tokenFn) {
  currentSession = session?.email
    ? { ...session, email: String(session.email).trim().toLowerCase() }
    : session;
  getAuthToken = tokenFn || null;
}

export function onSessionCleared() {
  currentSession = null;
  getAuthToken = null;
  pipelineState = null;
  companyNameTouched = false;
  newDealTitleTouched = false;
  pcDraftAccountName = "";
  pcDraftNewDealTitle = "";
  pcResolvedAccount = null;
  pcCreateNewAccount = false;
  pcSelectedDealId = null;
  pcCreateNewDeal = false;
  pcNewDealType = "new_business";
  pcLastAccountDeals = [];
  invalidatePostCallResolveContext();
  clearLinkedInAttachments("postcall");
  show($("postcall-form-view"), true);
  show($("postcall-result"), false);
  show($("postcall-confirm-view"), false);
  hidePipelineProgress("postcall-progress");
  void hidePostCallGenOverlay();
}

/** Test-only: set intake deal state for confirm gate smoke tests. */
export function __setIntakeDealStateForTests(state = {}) {
  if (state.createNewDeal != null) pcCreateNewDeal = state.createNewDeal;
  if (state.selectedDealId !== undefined) pcSelectedDealId = state.selectedDealId;
  if (state.newDealTitle !== undefined) pcDraftNewDealTitle = state.newDealTitle;
  if (state.createNewAccount != null) pcCreateNewAccount = state.createNewAccount;
  if (state.resolvedAccount !== undefined) pcResolvedAccount = state.resolvedAccount;
  if (state.accountName !== undefined) pcDraftAccountName = state.accountName;
  if (state.payload !== undefined) {
    pipelineState = state.payload ? { payload: state.payload } : null;
  }
}

export function __resetIntakeDealStateForTests() {
  pcCreateNewDeal = false;
  pcSelectedDealId = null;
  pcDraftNewDealTitle = "";
  pcCreateNewAccount = false;
  pcResolvedAccount = null;
  pcDraftAccountName = "";
  if (pipelineState && !pipelineState.resolve) pipelineState = null;
}

export function initPostcall() {
  const emailsEl = $("pc-prospect-emails");
  configureProspectEmailAntiAutofill(emailsEl);
  void ensurePostCallProspectEmailsEmpty();
  scheduleProspectEmailAutofillGuard();

  window.addEventListener("pageshow", () => {
    scheduleProspectEmailAutofillGuard();
  });

  $("postcall-form")?.addEventListener("submit", (e) => { void analyzeCall(e); });
  $("analyze-call")?.addEventListener("fwClick", (e) => { void analyzeCall(e); });

  const recordingUrl = $("pc-recording-url");
  recordingUrl?.addEventListener("fwInput", syncPasscodeVisibility);
  recordingUrl?.addEventListener("input", syncPasscodeVisibility);
  recordingUrl?.addEventListener("fwBlur", syncPasscodeVisibility);
  syncPasscodeVisibility();

  const recordingPwd = $("pc-recording-pwd");
  recordingPwd?.addEventListener("fwInput", syncPasscodeVisibility);
  recordingPwd?.addEventListener("input", syncPasscodeVisibility);

  const transcriptFile = $("pc-transcript-file");
  const transcriptFileBtn = $("pc-transcript-file-btn");
  transcriptFileBtn?.addEventListener("fwClick", () => transcriptFile?.click());
  transcriptFileBtn?.addEventListener("click", () => transcriptFile?.click());
  transcriptFile?.addEventListener("change", (e) => { void handleTranscriptFileChange(e); });

  emailsEl?.addEventListener("fwBlur", () => { void rejectSessionEmailInProspectField(emailsEl); void prefillCompanyFromEmails(); void renderCrmMatchesPanel(); });
  emailsEl?.addEventListener("blur", () => { void rejectSessionEmailInProspectField(emailsEl); void prefillCompanyFromEmails(); void renderCrmMatchesPanel(); });
  emailsEl?.addEventListener("fwInput", () => { void rejectSessionEmailInProspectField(emailsEl); scheduleCompanyPrefill(); });
  emailsEl?.addEventListener("input", () => { void rejectSessionEmailInProspectField(emailsEl); scheduleCompanyPrefill(); });

  initLinkedInPdfUpload({
    bag: "postcall",
    fileInputId: "pc-linkedin-pdfs",
    addBtnId: "pc-linkedin-add-btn",
    listElId: "pc-linkedin-file-list",
    errElId: "pc-linkedin-error",
    parsingElId: "pc-linkedin-parsing",
    setParsing: (on) => {
      linkedinParsing = on;
      const btn = $("analyze-call");
      if (btn) btn.disabled = on || contextParsing;
      const addBtn = $("pc-linkedin-add-btn");
      if (addBtn) addBtn.disabled = on;
    },
  });

  initContextFileUpload({
    bag: "postcall",
    fileInputId: "pc-context-files",
    addBtnId: "pc-context-add-btn",
    listElId: "pc-context-file-list",
    errElId: "pc-context-error",
    parsingElId: "pc-context-parsing",
    setParsing: (on) => {
      contextParsing = on;
      const btn = $("analyze-call");
      if (btn) btn.disabled = on || linkedinParsing;
      const addBtn = $("pc-context-add-btn");
      if (addBtn) addBtn.disabled = on;
    },
  });
}
