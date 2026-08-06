import {
  readFieldValue,
  readFieldValueAsync,
  setFieldError,
  setFieldValue,
  fillShadowField,
  bindActionOnce,
  setButtonLoading,
  renderLoadingPanel,
} from "./crayons-ui.js";
import { triggerSignInPulse } from "./lion-roar.js";
import { initSidebar } from "./sidebar.js";
import { initFeedback } from "./feedback.js";
import { initPrepDisputes } from "./prep-disputes.js";
import {
  authMode,
  getSession,
  loginDummy,
  logout,
  onSessionChange,
  persistFirebaseSession,
  sessionFromFirebaseUser,
  isManagerRole,
  syncSessionWithDomainStore,
  setSession,
  isFirebaseAuthEnabled,
  sessionUserId,
  withEffectiveUserId,
} from "./auth.js";
import {
  sessionMatchesFirebaseUser,
  shouldDeferNullAuth,
  shouldLogoutAfterNullCheck,
} from "./auth-firebase-guards.js";
import { initDomainStore, getStore } from "./domain/store.js";
import { clearLocalStoreCache } from "./domain/local-store.js";
import { linkPrepToLifecycle, linkPostCallToLifecycle } from "./domain/dual-write.js";
import { renderAccountView } from "./account-view.js?v=2.1.14";
import { renderDealView } from "./deal-view.js";
import { renderContactsView } from "./contacts-view.js?v=2.1.14";
import { renderCallView } from "./call-view.js";
import { renderCallsListView } from "./calls-list-view.js";
import { renderBriefsListView, normalizeRemoteBrief } from "./briefs-list-view.js";
import { initGlobalSearch, invalidateSearchIndex, warmSearchIndex } from "./global-search.js?v=2.1.14";
import { listPostCallAnalyses, getPostCallAnalysis, syncHistoryOnLogin, setHistoryAuthGetter, clearHistoryAuthGetter } from "./history.js";
import {
  syncTasksOnLogin,
  syncTasksAfterActivity,
  setTasksAuthGetter,
  clearTasksAuthGetter,
} from "./tasks.js";
import { setSummariesAuthGetter, clearSummariesAuthGetter } from "./domain/summaries-service.js";
import { setCallPayloadAuthGetter, clearCallPayloadAuthGetter } from "./domain/call-payload-storage.js";
import { setTimelineAuthGetter } from "./domain/timeline-service.js";
import {
  setProductSignalAuthGetter,
  clearProductSignalAuthGetter,
} from "./domain/product-signal-service.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { assertThemeScoreSuppressionReady } from "./theme-score-suppression.js";
import { renderDashboard, renderManagerDashboard, buildTeamThemeAverages, renderDashboardLoadingShell, renderManagerDashboardLoadingShell } from "./dashboard.js";
import { renderCoaching } from "./coaching.js";
import { renderSeDetailView } from "./se-detail-view.js";
import { renderPipelineView } from "./pipeline-view.js";
import { renderProductSignalView } from "./product-signal-view.js";
import { canSessionReadAccount, normalizeSeEmail } from "./domain/se-access-service.js";
import { invalidateSessionListCache } from "./domain/account-service.js?v=2.1.14";
import { stableUserIdForEmail } from "./domain/id.js";
import { initUserMenu, refreshUserMenu } from "./user-menu.js";
import { resetSessionGreeting } from "./greeting.js";
import { updateTopbarDate } from "./topbar-date.js";
import { renderProfileSettings } from "./profile-settings.js";
import {
  firebaseConfig,
  WORKER_BASE_URL,
  ALLOWED_EMAIL_DOMAIN,
  loadFirebaseConfig,
  isProductionHost,
} from "./firebase-config.js";
import {
  initPrecall,
  loadLocalBriefs,
  openPrepBrief,
  openPrepBriefAsync,
  parseProspectEmails,
  resetPrecallForm,
  showPrepBriefsListView,
  syncPrepEngagementMotion,
} from "./precall.js?v=2.1.14";
import {
  initPostcall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
  setOnCallRecordReady,
  setOnCallRecordHydrated,
  resetPostCallView,
  clearPostCallForm,
  ensurePostCallProspectEmailsEmpty,
  hidePostCallLegacyResult,
  isPostCallGenerationBusy,
  scheduleProspectEmailAutofillGuard,
} from "./postcall.js";
import {
  applyAutoCompanyDomain,
  domainFromFirstProspectEmail,
  companyNameFromPrimaryEmail,
  companyNameFromDomain,
  PERSONAL_EMAIL_DOMAINS,
  normalizeCompanyDomain as normalizePrepDomain,
  isProgrammaticDomainUpdate,
  prepDomainUiState,
} from "./prep-domain.js";
import { esc, $, show } from "./shared.js";

const prodBundle = typeof __PROD_BUNDLE__ !== "undefined" && __PROD_BUNDLE__;

const PREP_RESEARCH_URL = `${WORKER_BASE_URL}/api/prep/research`;
const PREP_SYNTHESIZE_URL = `${WORKER_BASE_URL}/api/prep/synthesize`;
const CONTACT_ENRICH_URL = `${WORKER_BASE_URL}/api/contact/enrich`;
const KAIA_SHARE_CONTENT_URL = `${WORKER_BASE_URL}/api/kaia/share-content`;
const FETCH_KAIA_SUMMARY_URL = `${WORKER_BASE_URL}/api/fetch-kaia-summary`;
const DASH_TAB_STORAGE_KEY = "lionpath-dashboard-tab"; /* legacy — no longer used */
function workerDownMessage(status, errName) {
  const host = typeof location !== "undefined" ? location.hostname : "";
  if (isProductionHost(host)) {
    if (host.endsWith(".run.app")) {
      const hint =
        status === 403
          ? "Cloud Run IAM blocked the API (403). Grant public invoker on prep-portal-api and add this web origin to ALLOWED_ORIGINS — see deploy/cloudrun/README.md."
          : "Check prep-portal-api is running, allows unauthenticated invoke, and ALLOWED_ORIGINS includes this web URL.";
      return `Cannot reach the API server at ${WORKER_BASE_URL}${status ? ` (HTTP ${status})` : ""}. ${hint}`;
    }
    const hint =
      status === 502
        ? "The API worker is down (502). SSH into the VPS and run: cd /opt/se-singha-paathai && git fetch origin 2.0.7.2 && git reset --hard origin/2.0.7.2 && cd deploy/vps && docker compose build --no-cache worker && docker compose up -d"
        : "On the VPS run: cd /opt/se-singha-paathai/deploy/vps && bash doctor.sh — check GEMINI_API_KEY in .env and restart with bash start.sh.";
    return `Cannot reach the API server at ${WORKER_BASE_URL}${status ? ` (HTTP ${status})` : ""}. ${hint}`;
  }
  return (
    `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
    "Start the worker: from the web folder run `npm run dev:all` (worker + web), or open a second terminal: `cd worker && npm run dev` (wait for Ready on port 8787). " +
    "Use the same hostname for both (localhost or 127.0.0.1, not mixed). The banner clears automatically when the worker comes up."
  );
}

let fb = null;
/** Resolves once Firebase auth state is restored (dummy mode: already resolved). */
let authReadyPromise = Promise.resolve();
/** @type {Promise<void>} */
let firebaseBootstrapPromise = Promise.resolve();

let currentSession = null;
let currentView = "dashboard";

const VIEW_TITLES = {
  dashboard: "My dashboard",
  precall: "Pre-call",
  postcall: "Post-call",
  accounts: "Accounts",
  deals: "My deals",
  contacts: "My contacts",
  calls: "All calls",
  coaching: "My coaching",
  manager: "Team",
  se: "SE detail",
  profile: "Profile settings",
  pipeline: "Pipeline review",
  signal: "Product signal",
};

let selectedAccountId = null;
/** @type {string|null|undefined} undefined = auto-resolve deal on account load */
let selectedAccountDealId = undefined;
let selectedAccountContactId = null;
/** @type {'new_business'|'expansion'|undefined} */
let selectedAccountEngagementPrepType = undefined;

function accountDetailHash() {
  if (!selectedAccountId) return "accounts";
  if (selectedAccountContactId) {
    return `accounts/${selectedAccountId}/contacts/${selectedAccountContactId}`;
  }
  if (selectedAccountDealId) {
    return `accounts/${selectedAccountId}/deals/${selectedAccountDealId}`;
  }
  return `accounts/${selectedAccountId}`;
}
/** Selected deal when Deals nav is active */
let selectedDealNavId = null;
/** Account to open when deal id from a call record is not navigable. */
let pendingDealFallbackAccountId = null;
/** Bumps on each deal panel render. stale async renders must not overwrite the DOM. */
let dealPanelRenderGen = 0;
/** Bumps on each call panel render. stale async renders must not overwrite the DOM. */
let callPanelRenderGen = 0;
/** Bumps on each account panel render. stale async renders must not overwrite the DOM. */
let accountPanelRenderGen = 0;
/** Bumps on each contacts panel render. stale async renders must not overwrite the DOM. */
let contactsPanelRenderGen = 0;
/** Bumps on each precall panel render. stale async renders must not overwrite the DOM. */
let precallPanelRenderGen = 0;
let dealListSearchQuery = "";
let dealListSortKey = "traction";
let pipelineQuarterFilter = "";
let pipelineSubRegionFilter = "";
let pipelineSortKey = "agents";

/** Selected call when viewing call record (#calls/:id) */
let selectedCallId = null;
/** Coalesce rapid post-call hydration updates into one panel refresh. */
let callRecordRefreshTimer = null;
let callRecordRefreshTargetId = null;
/** Selected brief when viewing from all-briefs list (#precall/briefs/:id) */
let selectedPrepBriefId = null;
/** True when pre-call shows all-briefs list (#precall/briefs) */
let precallBriefListMode = false;
/** @type {string|undefined} */
let callRecordTab = undefined;
let callExpandThemeKey = undefined;
/** Owner email when a manager opens a team member's call */
let callRecordOwnerEmail = undefined;

function parseLocationHash() {
  const raw = location.hash.replace(/^#/, "");
  const qIdx = raw.indexOf("?");
  const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : "");
  return { path, params };
}

function seDetailHash() {
  if (!selectedSeEmail) return "manager";
  const base = `se/${encodeURIComponent(selectedSeEmail)}`;
  if (seExpandThemeKey) return `${base}?theme=${encodeURIComponent(seExpandThemeKey)}`;
  return base;
}

function callDetailHash() {
  if (!selectedCallId) {
    if (callsListFilter) return `calls?filter=${encodeURIComponent(callsListFilter)}`;
    return "calls";
  }
  const params = new URLSearchParams();
  if (callRecordTab) params.set("tab", callRecordTab);
  if (callExpandThemeKey) params.set("theme", callExpandThemeKey);
  if (callRecordOwnerEmail) params.set("owner", callRecordOwnerEmail);
  const qs = params.toString();
  return qs ? `calls/${selectedCallId}?${qs}` : `calls/${selectedCallId}`;
}

function precallHash() {
  if (selectedPrepBriefId && precallBriefListMode) {
    return `precall/briefs/${selectedPrepBriefId}`;
  }
  if (precallBriefListMode) return "precall/briefs";
  return "precall";
}

function dealDetailHash() {
  if (selectedDealNavId) return `deals/${selectedDealNavId}`;
  if (dealListTractionFilter) return `deals?filter=${encodeURIComponent(dealListTractionFilter)}`;
  return "deals";
}

function pipelineHash() {
  const params = new URLSearchParams();
  if (pipelineQuarterFilter) params.set("quarter", pipelineQuarterFilter);
  if (pipelineSubRegionFilter) params.set("sub", pipelineSubRegionFilter);
  if (pipelineSortKey && pipelineSortKey !== "agents") params.set("sort", pipelineSortKey);
  const qs = params.toString();
  return qs ? `pipeline?${qs}` : "pipeline";
}

/** Selected SE on manager drill-down (#se/:email) */
let selectedSeEmail = null;
let seExpandThemeKey = undefined;
let callsListFilter = "";
let dealListTractionFilter = "";
let callsFilterType = "";
let callsFilterWindow = "30d";
let accountListSearchQuery = "";
let accountDetailSearchQuery = "";
let accountLifecycleOwnerId = null;

/** @deprecated use prepDomainUiState — kept as alias for local handlers */
const prepDomainState = prepDomainUiState;

let prepDomainSyncTimer = null;

function syncAutoCompanyDomain() {
  const domainField = $("companyDomain");
  if (!domainField) return;
  const domainRaw = readFieldValue(domainField);
  if (!String(domainRaw || "").trim()) {
    prepDomainState.userEdited = false;
    prepDomainState.lastAutoValue = null;
  } else {
    const normalized = normalizeCompanyDomainField(domainRaw);
    const lastAuto = prepDomainState.lastAutoValue
      ? normalizeCompanyDomainField(prepDomainState.lastAutoValue)
      : null;
    if (lastAuto && normalized === lastAuto) {
      prepDomainState.userEdited = false;
    }
  }
  const emailsRaw = readFieldValue($("prospectEmail"));
  const result = applyAutoCompanyDomain(domainField, emailsRaw, prepDomainState);
  if (result.lastAutoValue != null) prepDomainState.lastAutoValue = result.lastAutoValue;
}

function scheduleSyncAutoCompanyDomain() {
  if (prepDomainSyncTimer) clearTimeout(prepDomainSyncTimer);
  prepDomainSyncTimer = setTimeout(() => {
    prepDomainSyncTimer = null;
    syncAutoCompanyDomain();
    updateDomainHint();
  }, 300);
}

function onProspectEmailInput() {
  scheduleSyncAutoCompanyDomain();
}

function onProspectEmailBlur() {
  if (prepDomainSyncTimer) {
    clearTimeout(prepDomainSyncTimer);
    prepDomainSyncTimer = null;
  }
  syncAutoCompanyDomain();
  updateDomainHint();
}

function emailDomain(emailRaw) {
  const emails = parseProspectEmails(emailRaw);
  const email = emails[0] || String(emailRaw || "").trim();
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;
const DOMAIN_TYPO_MARKERS = [/acadmey/i, /academey/i, /acadamy/i];
const WELL_KNOWN_DOMAINS = {
  "khan academy": "khanacademy.org",
  "khan academey": "khanacademy.org",
};

function suggestDomainFromCompany(companyName) {
  const key = String(companyName || "").trim().toLowerCase();
  if (WELL_KNOWN_DOMAINS[key]) return WELL_KNOWN_DOMAINS[key];
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 4) {
    const slug = words.join("").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (slug.length >= 4) return `${slug}.com`;
  }
  return null;
}

function validateProspectDomain(emailRaw, companyName) {
  const emails = parseProspectEmails(emailRaw);
  const email = emails[0] || String(emailRaw || "").trim();
  const domain = emailDomain(email);
  if (!email?.trim()) return null;
  const hints = [];
  if (domain && !DOMAIN_RE.test(domain)) hints.push("Email domain format looks invalid.");
  if (domain && DOMAIN_TYPO_MARKERS.some((p) => p.test(domain))) {
    const suggested = suggestDomainFromCompany(companyName) || "khanacademy.org";
    hints.push(`Possible typo. Did you mean ${suggested}?`);
  }
  const suggested = suggestDomainFromCompany(companyName);
  if (suggested && domain && domain !== suggested) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm(domain.split(".")[0]) !== norm(suggested.split(".")[0])) {
      hints.push(`For ${companyName.trim()}, official domain is usually ${suggested}.`);
    }
  }
  return hints.length ? hints.join(" ") : null;
}

function onCompanyDomainInput() {
  if (isProgrammaticDomainUpdate()) return;
  const v = readFieldValue($("companyDomain"));
  const normalized = normalizeCompanyDomainField(v);
  const lastAuto = prepDomainState.lastAutoValue
    ? normalizeCompanyDomainField(prepDomainState.lastAutoValue)
    : null;
  if (!normalized) {
    prepDomainState.userEdited = false;
    prepDomainState.lastAutoValue = null;
  } else if (lastAuto && normalized === lastAuto) {
    prepDomainState.userEdited = false;
  } else {
    prepDomainState.userEdited = true;
  }
  updateDomainHint();
}

function updateDomainHint() {
  const hint = $("domain-hint");
  if (!hint) return;
  const companyDomain = normalizeCompanyDomainField(readFieldValue($("companyDomain")));
  const emailsRaw = readFieldValue($("prospectEmail"));
  const companyName =
    companyNameFromPrimaryEmail(emailsRaw) || companyNameFromDomain(companyDomain) || "";
  const emailMsg = validateProspectDomain(emailsRaw, companyName);
  const hints = [];
  if (emailMsg) hints.push(emailMsg);
  const inferred = domainFromFirstProspectEmail(emailsRaw);
  const firstDomain = normalizePrepDomain(emailDomain(emailsRaw));
  if (!companyDomain && firstDomain && PERSONAL_EMAIL_DOMAINS.has(firstDomain)) {
    hints.push("Enter company website; we can't infer it from a personal email (Gmail, Outlook, etc.).");
  } else if (!companyDomain && emailsRaw.trim() && !inferred) {
    hints.push("Enter company website if prospect email doesn't use a corporate domain.");
  }
  if (companyDomain && !DOMAIN_RE.test(companyDomain)) {
    hints.push("Company domain format looks invalid (use acme.com).");
  }
  const emailDomainVal = emailDomain(emailsRaw);
  if (companyDomain && emailDomainVal && companyDomain !== emailDomainVal && !PERSONAL_EMAIL_DOMAINS.has(emailDomainVal)) {
    hints.push(`Prospect email domain (${emailDomainVal}) differs from company domain (${companyDomain}).`);
  }
  if (hints.length) {
    hint.textContent = hints.join(" ");
    hint.className = "field-hint warn";
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function normalizeCompanyDomainField(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function prepDocToBrief(doc) {
  const data = doc.data();
  const when =
    data.createdAt?.toDate?.()?.toLocaleDateString?.() ||
    data.when ||
    "";
  return normalizeRemoteBrief({
    id: doc.id,
    company: data.company,
    when,
    prep: data.prep,
    prospectEmail: data.prospectEmail,
    additionalContext: data.additionalContext,
    meta: data.meta,
    input: data.input,
    lifecycleId: data.lifecycleId,
  });
}

/** Lazy Firestore fetch — checks auth at call time so dashboard KPI is not stuck at 0. */
function withFetchTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Max prep docs fetched for dashboard KPI (most-recent first). */
const PREP_HISTORY_LIMIT = 100;

function buildFetchAllRemotePreps() {
  return async () => {
    if (!isFirebaseAuthEnabled() || !fb?.auth?.currentUser || !fb?.db) return [];
    const user = fb.auth.currentUser;
    const email = String(user.email || currentSession?.email || "")
      .trim()
      .toLowerCase();
    const seen = new Set();
    const docs = [];

    const collect = (snap) => {
      if (!snap?.docs) return;
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        docs.push(doc);
      }
    };

    try {
      const snap = await withFetchTimeout(
        fb.getDocs(
          fb.query(
            fb.collection(fb.db, "preps"),
            fb.where("uid", "==", user.uid),
            fb.orderBy("createdAt", "desc"),
            fb.limit(PREP_HISTORY_LIMIT),
          ),
        ),
      );
      collect(snap);
    } catch (err) {
      console.warn("[app] preps uid query failed:", err?.message || err);
    }

    if (email) {
      try {
        const snap = await withFetchTimeout(
          fb.getDocs(
            fb.query(
              fb.collection(fb.db, "preps"),
              fb.where("email", "==", email),
              fb.orderBy("createdAt", "desc"),
              fb.limit(PREP_HISTORY_LIMIT),
            ),
          ),
        );
        collect(snap);
      } catch (err) {
        console.warn("[app] preps email query failed:", err?.message || err);
      }
    }

    return docs.map(prepDocToBrief).filter(Boolean);
  };
}

function buildFetchRemotePreps() {
  const fetchAll = buildFetchAllRemotePreps();
  return async () => {
    const all = await fetchAll();
    return (all || []).map((b) => ({
      id: b.id,
      company: b.company,
      when: b.when,
    }));
  };
}

/** Lazy Worker KV history fetch — checks auth at call time so dashboard KPIs are not stuck at 0. */
function buildFetchRemoteHistory() {
  return async () => {
    const email = currentSession?.email;
    if (!email) return [];
    if (isFirebaseAuthEnabled() && fb?.auth?.currentUser) {
      setHistoryAuthGetter(() => fb.auth.currentUser.getIdToken());
    }
    return syncHistoryOnLogin(email);
  };
}

let historyHydratedForEmail = null;

function dashboardOpts(extra = {}) {
  return {
    session: currentSession,
    seName: currentSession?.name,
    fetchAllRemotePreps: buildFetchAllRemotePreps(),
    fetchRemotePreps: buildFetchRemotePreps(),
    fetchRemoteHistory: buildFetchRemoteHistory(),
    skipRemoteHistory: extra.skipRemoteHistory ?? historyHydratedForEmail !== currentSession?.email,
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
    onPrep: () => {
      switchView("precall");
    },
    onAnalyze: () => {
      switchView("postcall");
    },
    onOpenCalls: () => {
      callsFilterWindow = "all";
      callsListFilter = "";
      selectedCallId = null;
      switchView("calls");
    },
    onOpenBriefs: () => {
      selectedPrepBriefId = null;
      precallBriefListMode = true;
      switchView("precall", { briefList: true, drillDown: true });
    },
    onOpenBrief: (id) => {
      openPrepBriefItem(id);
    },
    onCoaching: () => {
      switchView("coaching");
    },
  };
}

const MANAGER_DRILL_VIEWS = new Set(["accounts", "deals", "calls", "se"]);

function managerDashboardOpts() {
  return {
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
    onOpenSe: (email, { theme } = {}) => openSeDetail(email, { theme }),
    onOpenTeamTheme: (theme) => {
      const view = $("view-manager")?._managerView;
      if (!view?.seRows?.length) return;
      const weakest = [...view.seRows].sort((a, b) => (a.avgScore ?? 100) - (b.avgScore ?? 100))[0];
      if (weakest?.email) openSeDetail(weakest.email, { theme });
    },
    onOpenFilteredDeals: (filter) => {
      dealListTractionFilter = filter || "";
      selectedDealNavId = null;
      switchView("deals", { drillDown: true });
    },
    onOpenFilteredCalls: (filter) => {
      callsListFilter = filter || "";
      selectedCallId = null;
      switchView("calls", { drillDown: true });
    },
  };
}

function openSeDetail(email, { theme } = {}) {
  selectedSeEmail = normalizeSeEmail(email);
  seExpandThemeKey = theme || undefined;
  switchView("se", { drillDown: true, theme });
}

async function renderSePanel() {
  const panel = $("view-se");
  if (!panel || !currentSession?.email || !selectedSeEmail) return;

  const managerView = $("view-manager")?._managerView;
  const teamThemeAverages = managerView?.seScorecardsByEmail
    ? buildTeamThemeAverages(managerView.seScorecardsByEmail)
    : undefined;

  await renderSeDetailView(panel, currentSession, {
    targetEmail: selectedSeEmail,
    expandThemeKey: seExpandThemeKey,
    teamThemeAverages,
    reportsTo: isManagerRole(currentSession) ? currentSession.name : undefined,
    onBack: isManagerRole(currentSession)
      ? () => {
          selectedSeEmail = null;
          seExpandThemeKey = undefined;
          switchView("manager");
        }
      : undefined,
    onExpandTheme: (themeKey) => {
      seExpandThemeKey = themeKey;
      history.replaceState(null, "", `#${seDetailHash()}`);
      void renderSePanel();
    },
    onOpenAccount: async (accountId) => {
      if (!(await canSessionReadAccount(currentSession, accountId))) return;
      selectedAccountId = accountId;
      selectedAccountDealId = null;
      selectedAccountContactId = null;
      switchView("accounts", { accountId, drillDown: true });
    },
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
  });
}

async function renderDashboardPanels(email, opts = {}) {
  const panel = $("dash-panel");
  if (panel && !panel.querySelector(".launchpad")) {
    renderDashboardLoadingShell(panel);
  }
  await renderDashboard(panel, email, opts);
}

async function renderCoachingPanel(email, opts = {}) {
  renderCoaching($("coaching-panel"), email, {
    onOpenCall: opts.onOpenCall || ((id) => openHistoryItem(id)),
  });
}

function updateNavForRole() {
  const isManager = isManagerRole(currentSession);
  const isLeader = currentSession?.isOrgDirector === true;
  const isCurator = currentSession?.role === "admin" || currentSession?.role === "pm";
  let rollupVisible = false;
  document.querySelectorAll(".nav-item[data-role]").forEach((btn) => {
    const role = btn.dataset.role;
    let showBtn;
    if (role === "manager") showBtn = isManager;
    else if (role === "leader") showBtn = isLeader;
    else if (role === "curator") showBtn = isCurator;
    else showBtn = !isManager;
    btn.hidden = !showBtn;
    if (showBtn && (role === "manager" || role === "leader" || role === "curator")) {
      rollupVisible = true;
    }
  });
  const rollupGrp = document.querySelector(".nav-grp--rollup");
  if (rollupGrp) rollupGrp.hidden = !rollupVisible;
  const globalSearch = $("global-search-input");
  if (globalSearch) globalSearch.hidden = isManager;
}

function refreshActiveDashboard() {
  if (!currentSession?.email) return;
  if (isManagerRole(currentSession)) {
    if (currentView === "manager") {
      void renderManagerDashboard($("view-manager"), currentSession, managerDashboardOpts());
    }
    if (currentView === "pipeline" && currentSession?.isOrgDirector) {
      void renderPipelinePanel();
    }
    if (currentView === "se" && selectedSeEmail) {
      void renderSePanel();
    }
    return;
  }
  if (currentView === "se" && selectedSeEmail) {
    void renderSePanel();
    return;
  }
  if (currentView === "dashboard") {
    void renderDashboardPanels(currentSession.email, dashboardOpts());
  }
}

// ---------- Views ----------

function normalizeViewName(name) {
  if (name === "analysis" || name === "workspace") return "postcall";
  if (name === "lifecycles") return "accounts";
  return name;
}

function switchView(name, opts = {}) {
  if (name === "coaching" || name === "dashboard/coaching") {
    name = "coaching";
  }
  name = normalizeViewName(name);
  const prevView = currentView;
  currentView = name;
  const isManager = isManagerRole(currentSession);
  const panels = {
    dashboard: $("view-dashboard"),
    coaching: $("view-coaching"),
    precall: $("view-precall"),
    postcall: $("view-postcall"),
    accounts: $("view-accounts"),
    deals: $("view-deals"),
    contacts: $("view-contacts"),
    calls: $("view-calls"),
    manager: $("view-manager"),
    pipeline: $("view-pipeline"),
    signal: $("view-signal"),
    se: $("view-se"),
    profile: $("view-profile"),
  };

  if (name === "pipeline" && !currentSession?.isOrgDirector) {
    name = isManager ? "manager" : "dashboard";
  }
  const isCurator = currentSession?.role === "admin" || currentSession?.role === "pm";
  if (name === "signal" && !isCurator) {
    name = isManager ? "manager" : "dashboard";
  }

  if (name === "profile") {
    Object.entries(panels).forEach(([key, el]) => show(el, key === "profile"));
    $("main-view-title").textContent = VIEW_TITLES.profile;
    document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.remove("active"));
    renderProfileSettings($("profile-settings-root"), currentSession, {
      onSaved: (next) => {
        currentSession = next;
      },
    });
    location.hash = "profile";
    return;
  }

  if (isManager) {
    const allowDrill = opts.drillDown === true || MANAGER_DRILL_VIEWS.has(name);
    if (!allowDrill && (name === "dashboard" || name === "coaching" || name === "precall" || name === "postcall")) {
      name = "manager";
    }
  } else if (name === "manager") {
    name = "dashboard";
  } else if (name === "se" && !selectedSeEmail) {
    name = "dashboard";
  }

  Object.entries(panels).forEach(([key, el]) => show(el, key === name));
  $("main-view-title").textContent = VIEW_TITLES[name] || name;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "dashboard" && !isManager) {
    void renderDashboardPanels(currentSession.email, dashboardOpts());
  } else if (name === "coaching" && !isManager) {
    void renderCoachingPanel(currentSession.email, dashboardOpts());
  } else if (name === "manager" && isManager) {
    void renderManagerDashboard($("view-manager"), currentSession, managerDashboardOpts());
  } else if (name === "pipeline" && currentSession?.isOrgDirector) {
    void renderPipelinePanel();
  } else if (name === "signal" && isCurator) {
    void renderProductSignalPanel();
  } else if (name === "se") {
    if (opts.targetEmail) selectedSeEmail = normalizeSeEmail(opts.targetEmail);
    if (opts.theme) seExpandThemeKey = opts.theme;
    $("main-view-title").textContent = VIEW_TITLES.se;
    void renderSePanel();
  } else if (name === "accounts") {
    if (opts.accountId) {
      selectedAccountId = opts.accountId;
      if (typeof opts.dealId === "string" && opts.dealId) {
        selectedAccountDealId = opts.dealId;
      } else if (opts.dealId === null || !opts.drillDown) {
        selectedAccountDealId = null;
      }
      if (opts.contactId) selectedAccountContactId = opts.contactId;
      else if (!opts.drillDown) selectedAccountContactId = null;
      if (opts.dealId === null) {
        selectedAccountEngagementPrepType = undefined;
        accountDetailSearchQuery = "";
      }
    } else if (!opts.drillDown) {
      selectedAccountId = null;
      selectedAccountDealId = null;
      selectedAccountEngagementPrepType = undefined;
      selectedAccountContactId = null;
      accountLifecycleOwnerId = null;
    }
    void renderAccountPanel();
  } else if (name === "deals") {
    if (opts.dealId) selectedDealNavId = opts.dealId;
    if (opts.accountId) pendingDealFallbackAccountId = opts.accountId;
    void renderDealPanel();
  } else if (name === "contacts") {
    void renderContactsPanel();
  } else if (name === "calls") {
    if (opts.callId) selectedCallId = opts.callId;
    else if (!opts.drillDown) selectedCallId = null;
    if (opts.callTab) callRecordTab = opts.callTab;
    if (opts.expandTheme) callExpandThemeKey = opts.expandTheme;
    if (opts.ownerEmail) callRecordOwnerEmail = opts.ownerEmail;
    if (opts.listFilter) callsListFilter = opts.listFilter;
    $("main-view-title").textContent = selectedCallId ? "Call record" : VIEW_TITLES.calls;
    void renderCallPanel();
  } else if (name === "precall") {
    if (opts.briefId) {
      selectedPrepBriefId = opts.briefId;
      if (opts.briefList !== false) precallBriefListMode = true;
    } else if (opts.briefList) {
      precallBriefListMode = true;
      selectedPrepBriefId = null;
    } else if (!opts.keepBrief && !opts.drillDown) {
      precallBriefListMode = false;
      selectedPrepBriefId = null;
      resetPrecallForm();
    }
    $("main-view-title").textContent = selectedPrepBriefId
      ? "Pre-call brief"
      : precallBriefListMode
        ? "All briefs"
        : VIEW_TITLES.precall;
    if (opts.briefList || opts.briefId) {
      void renderPrecallPanel();
    } else if (opts.keepBrief) {
      /* brief already open — leave DOM as-is */
    } else if (!opts.drillDown) {
      /* resetPrecallForm already ran */
    }
  }

  const hash =
    name === "se"
        ? seDetailHash()
        : name === "accounts" && selectedAccountId
          ? accountDetailHash()
          : name === "deals"
            ? dealDetailHash()
            : name === "calls"
              ? callDetailHash()
              : name === "precall"
                ? precallHash()
                : name === "pipeline"
                  ? pipelineHash()
                  : name;
  history.replaceState(null, "", `#${hash}`);
  closeSidebar();
  if (prevView === "precall" && name !== "precall") {
    precallBriefListMode = false;
    selectedPrepBriefId = null;
    resetPrecallForm();
  }
  if (name === "precall") {
    if (!opts.keepBrief && !opts.briefList && !opts.briefId && !opts.drillDown) {
      resetPrecallForm();
    }
    syncPrepEngagementMotion();
  }
  if (name === "postcall" && !isPostCallGenerationBusy()) {
    resetPostCallView();
    void setFieldValue($("login-email"), "");
    void setFieldValue($("login-password"), "");
    scheduleProspectEmailAutofillGuard();
  }
}

async function renderAccountPanel() {
  const panel = $("account-panel");
  if (!panel || !currentSession?.email) return;
  if (!selectedAccountId && !panel.querySelector(".account-list-view")) {
    panel.innerHTML = `<div class="lifecycle-list-view account-list-view account-list-view--loading">${renderLoadingPanel("Loading accounts…")}</div>`;
  }
  const gen = ++accountPanelRenderGen;
  let session = currentSession;
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
      if (sessionUserId(session)) {
        currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
      }
    } catch (err) {
      console.warn("[app] account panel session sync failed:", err);
    }
  }
  session = withEffectiveUserId(session);
  if (session?.email) {
    currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
    session = currentSession;
  }
  await renderAccountView(panel, session, {
    accountId: selectedAccountId || undefined,
    ...(selectedAccountId
      ? {
          dealId:
            typeof selectedAccountDealId === "string" && selectedAccountDealId
              ? selectedAccountDealId
              : null,
        }
      : {}),
    ...(selectedAccountEngagementPrepType ? { engagementPrepType: selectedAccountEngagementPrepType } : {}),
    contactId: selectedAccountContactId || undefined,
    lifecycleOwnerId: accountLifecycleOwnerId || undefined,
    listSearchQuery: accountListSearchQuery,
    detailSearchQuery: accountDetailSearchQuery,
    shouldApply: () => gen === accountPanelRenderGen,
    onListSearchQueryChange: (q) => {
      accountListSearchQuery = q;
    },
    onDetailSearchQueryChange: (q) => {
      accountDetailSearchQuery = q;
    },
    onLifecycleLensChange: (ownerId) => {
      accountLifecycleOwnerId = ownerId;
    },
    onDealChange: (dealId, engagementPrepType) => {
      selectedAccountDealId = dealId;
      if (engagementPrepType === "expansion" || engagementPrepType === "new_business") {
        selectedAccountEngagementPrepType = engagementPrepType;
      } else if (dealId) {
        selectedAccountEngagementPrepType = undefined;
      }
      selectedAccountContactId = null;
      if (selectedAccountId) {
        history.replaceState(null, "", `#${accountDetailHash()}`);
      }
    },
    onBackToAccount: () => {
      selectedAccountDealId = null;
      selectedAccountEngagementPrepType = undefined;
      selectedAccountContactId = null;
      accountDetailSearchQuery = "";
      if (selectedAccountId) {
        history.replaceState(null, "", `#${accountDetailHash()}`);
      }
    },
    onContactChange: (contactId) => {
      selectedAccountContactId = contactId || null;
      if (selectedAccountId) {
        history.replaceState(null, "", `#${accountDetailHash()}`);
      }
    },
    onSeTeamChange: () => {
      void renderAccountPanel();
    },
    onSelectAccount: (id) => {
      selectedAccountId = id;
      selectedAccountDealId = null;
      selectedAccountEngagementPrepType = undefined;
      selectedAccountContactId = null;
      accountLifecycleOwnerId = null;
      accountDetailSearchQuery = "";
      switchView("accounts", { accountId: id, dealId: null, drillDown: true });
    },
    onBack: () => {
      selectedAccountId = null;
      selectedAccountDealId = undefined;
      selectedAccountEngagementPrepType = undefined;
      selectedAccountContactId = null;
      accountDetailSearchQuery = "";
      accountLifecycleOwnerId = null;
      switchView("accounts");
    },
    onPrep: () => switchView("precall"),
    onPostcall: () => switchView("postcall"),
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
  });
}

async function renderPipelinePanel() {
  const panel = $("pipeline-panel");
  if (!panel || !currentSession?.email) return;
  let session = currentSession;
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
      if (sessionUserId(session)) {
        currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
      }
    } catch (err) {
      console.warn("[app] pipeline panel session sync failed:", err);
    }
  }
  await renderPipelineView(panel, session, {
    quarterFilter: pipelineQuarterFilter,
    subRegionFilter: pipelineSubRegionFilter,
    sortKey: pipelineSortKey,
    onFiltersChange: ({ quarterFilter, subRegionFilter }) => {
      pipelineQuarterFilter = quarterFilter || "";
      pipelineSubRegionFilter = subRegionFilter || "";
      history.replaceState(null, "", `#${pipelineHash()}`);
      void renderPipelinePanel();
    },
    onSortKeyChange: (key) => {
      pipelineSortKey = key === "arr" || key === "mrr" ? key : "agents";
      history.replaceState(null, "", `#${pipelineHash()}`);
      void renderPipelinePanel();
    },
    onSelectDeal: (dealId) => {
      selectedDealNavId = dealId;
      switchView("deals", { dealId, drillDown: true });
    },
  });
}

async function renderProductSignalPanel() {
  const panel = $("product-signal-panel");
  if (!panel || !currentSession?.email) return;
  let session = currentSession;
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
      if (sessionUserId(session)) {
        currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
      }
    } catch (err) {
      console.warn("[app] product signal panel session sync failed:", err);
    }
  }
  await renderProductSignalView(session, panel, {
    onRefresh: () => void renderProductSignalPanel(),
  });
}

async function renderDealPanel() {
  const panel = $("deal-panel");
  if (!panel || !currentSession?.email) return;
  if (!selectedDealNavId && !panel.querySelector(".deal-list-view")) {
    panel.innerHTML = `<div class="lifecycle-list-view deal-list-view deal-list-view--loading">${renderLoadingPanel("Loading deals…")}</div>`;
  }
  const gen = ++dealPanelRenderGen;
  let session = currentSession;
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
      if (sessionUserId(session)) {
        currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
      }
    } catch (err) {
      console.warn("[app] deal panel session sync failed:", err);
    }
  }
  session = withEffectiveUserId(session);
  if (session?.email) {
    currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
    session = currentSession;
  }
  await renderDealView(panel, session, {
    dealId: selectedDealNavId || undefined,
    lifecycleOwnerId: accountLifecycleOwnerId || undefined,
    listSearchQuery: dealListSearchQuery,
    listSortKey: dealListSortKey,
    listTractionFilter: dealListTractionFilter,
    detailSearchQuery: accountDetailSearchQuery,
    shouldApply: () => gen === dealPanelRenderGen,
    onInvalidDealId: () => {
      if (gen !== dealPanelRenderGen) return;
      const fallbackAccountId = pendingDealFallbackAccountId;
      pendingDealFallbackAccountId = null;
      selectedDealNavId = null;
      if (fallbackAccountId) {
        console.warn("[app] deal id not navigable, falling back to account:", fallbackAccountId);
        selectedAccountId = fallbackAccountId;
        selectedAccountDealId = null;
        switchView("accounts", { accountId: fallbackAccountId, drillDown: true });
        return;
      }
      history.replaceState(null, "", `#${dealDetailHash()}`);
      void renderDealPanel();
    },
    onResolvedDealId: (dealId) => {
      if (gen !== dealPanelRenderGen) return;
      pendingDealFallbackAccountId = null;
      selectedDealNavId = dealId;
      history.replaceState(null, "", `#${dealDetailHash()}`);
    },
    onListSearchQueryChange: (q) => {
      dealListSearchQuery = q;
    },
    onListSortKeyChange: (key) => {
      dealListSortKey = key;
    },
    onDetailSearchQueryChange: (q) => {
      accountDetailSearchQuery = q;
    },
    onLifecycleLensChange: (ownerId) => {
      accountLifecycleOwnerId = ownerId;
    },
    onSelectDeal: (dealId) => {
      selectedDealNavId = dealId;
      history.replaceState(null, "", `#${dealDetailHash()}`);
      void renderDealPanel();
    },
    onBackToDealList: () => {
      selectedDealNavId = null;
      accountDetailSearchQuery = "";
      history.replaceState(null, "", `#${dealDetailHash()}`);
      void renderDealPanel();
    },
    onSeTeamChange: () => {
      void renderDealPanel();
    },
    onDealChange: (dealId, engagementPrepType) => {
      selectedDealNavId = dealId || selectedDealNavId;
      if (engagementPrepType === "expansion" || engagementPrepType === "new_business") {
        selectedAccountEngagementPrepType = engagementPrepType;
      }
      if (selectedDealNavId) {
        history.replaceState(null, "", `#${dealDetailHash()}`);
      }
    },
    onPrep: () => switchView("precall"),
    onPostcall: () => switchView("postcall"),
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
    onOpenAccount: (accountId) => {
      if (accountId) switchView("accounts", { accountId, drillDown: true });
    },
  });
}

async function renderContactsPanel() {
  const panel = $("contacts-panel");
  if (!panel || !currentSession?.email) return;
  const gen = ++contactsPanelRenderGen;
  let session = withEffectiveUserId(currentSession);
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
    } catch (err) {
      console.warn("[app] contacts panel session sync failed:", err);
    }
  }
  await renderContactsView(panel, session, {
    shouldApply: () => gen === contactsPanelRenderGen,
    onOpenAccount: (accountId, contactId) => {
      if (accountId) switchView("accounts", { accountId, contactId, drillDown: true });
    },
  });
}

async function renderPrecallPanel() {
  const listHost = $("prep-briefs-list-view");
  if (!currentSession?.email) return;
  const gen = ++precallPanelRenderGen;

  if (selectedPrepBriefId) {
    const ok = await openPrepBriefAsync(selectedPrepBriefId, buildFetchAllRemotePreps(), {
      fromList: precallBriefListMode,
    });
    if (gen !== precallPanelRenderGen) return;
    if (!ok) {
      selectedPrepBriefId = null;
      if (precallBriefListMode) {
        showPrepBriefsListView();
        await renderBriefsListView(listHost, currentSession, {
          fetchAllRemotePreps: buildFetchAllRemotePreps(),
          onSelectBrief: (id) => openPrepBriefFromList(id),
        });
      } else {
        resetPrecallForm();
      }
    }
    return;
  }

  if (precallBriefListMode) {
    showPrepBriefsListView();
    if (!listHost) return;
    await renderBriefsListView(listHost, currentSession, {
      fetchAllRemotePreps: buildFetchAllRemotePreps(),
      onSelectBrief: (id) => openPrepBriefFromList(id),
    });
  }
}

function openPrepBriefFromList(id) {
  if (!id) return;
  selectedPrepBriefId = id;
  precallBriefListMode = true;
  switchView("precall", { briefId: id, briefList: true, drillDown: true });
  document.querySelectorAll(".sidebar-prep-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function backToBriefsList() {
  selectedPrepBriefId = null;
  precallBriefListMode = true;
  switchView("precall", { briefList: true, drillDown: true });
}

function scheduleCallRecordPanelRefresh(id, { immediate = false } = {}) {
  if (selectedCallId !== id || currentView !== "calls") return;
  const record = currentSession?.email ? getPostCallAnalysis(currentSession.email, id) : null;
  const pending = record?.result?.hydration?.pending || [];
  if (!immediate && pending.length > 0) {
    callRecordRefreshTargetId = id;
    return;
  }
  callRecordRefreshTargetId = id;
  window.clearTimeout(callRecordRefreshTimer);
  if (immediate) {
    callRecordRefreshTargetId = null;
    void renderCallPanel();
    return;
  }
  callRecordRefreshTimer = window.setTimeout(() => {
    callRecordRefreshTimer = null;
    if (callRecordRefreshTargetId === id) {
      callRecordRefreshTargetId = null;
      void renderCallPanel();
    }
  }, 900);
}

async function renderCallPanel() {
  const panel = $("call-panel");
  if (!panel || !currentSession?.email) return;
  const gen = ++callPanelRenderGen;
  let session = currentSession;
  if (!sessionUserId(session)) {
    try {
      session = (await syncSessionWithDomainStore(session)) || session;
    } catch (err) {
      console.warn("[app] call panel session sync failed:", err);
    }
  }
  session = withEffectiveUserId(session);
  if (session?.email) {
    currentSession = { ...session, email: String(session.email).trim().toLowerCase() };
    session = currentSession;
  }
  if (selectedCallId) {
    const ownerEmail = callRecordOwnerEmail;
    const initialTab = callRecordTab;
    const expandTheme = callExpandThemeKey;
    await renderCallView(panel, session, {
      callId: selectedCallId,
      ownerEmail,
      initialTab,
      expandThemeKey: expandTheme,
      shouldApply: () => gen === callPanelRenderGen,
      onBack: () => {
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("calls", { drillDown: true });
      },
      onOpenDeal: (dealId, meta = {}) => {
        selectedDealNavId = dealId;
        pendingDealFallbackAccountId = meta.accountId || null;
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("deals", { dealId, drillDown: true });
      },
      onOpenAccount: (accountId, contactId) => {
        selectedAccountId = accountId;
        selectedAccountDealId = null;
        selectedAccountContactId = contactId || null;
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("accounts", { accountId, contactId, drillDown: true });
      },
      onNewPostCall: () => {
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        clearPostCallForm();
        resetPostCallView();
        switchView("postcall");
      },
    });
    callRecordTab = undefined;
    callExpandThemeKey = undefined;
    return;
  }
  await renderCallsListView(panel, session, {
    callType: callsFilterType,
    window: callsFilterWindow,
    listFilter: callsListFilter,
    teamScope: isManagerRole(currentSession),
    onFiltersChange: ({ callType, window }) => {
      callsFilterType = callType || "";
      callsFilterWindow = window || "30d";
    },
    onSelectCall: (id, rowOpts = {}) => {
      selectedCallId = id;
      if (rowOpts.ownerEmail) callRecordOwnerEmail = rowOpts.ownerEmail;
      switchView("calls", { callId: id, drillDown: true, ownerEmail: rowOpts.ownerEmail });
    },
  });
}

function openCallRecord(id, opts = {}) {
  if (!id) return;
  hidePostCallLegacyResult();
  selectedCallId = id;
  if (opts.tab) callRecordTab = opts.tab;
  if (opts.expandTheme) callExpandThemeKey = opts.expandTheme;
  if (opts.ownerEmail) callRecordOwnerEmail = normalizeSeEmail(opts.ownerEmail);
  switchView("calls", {
    callId: id,
    callTab: opts.tab,
    expandTheme: opts.expandTheme,
    ownerEmail: opts.ownerEmail,
    drillDown: true,
  });
  document.querySelectorAll(".sidebar-call-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

/** Apply top-level hash routes when the user navigates with back/forward. */
function restoreAuthenticatedShell() {
  if (!getSession()?.email) return false;
  show($("login-view"), false);
  show($("app-shell"), true);
  return true;
}

async function paintAuthenticatedShell() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  show($("app-loading"), false);
}

function applyRouteFromHash() {
  if (!currentSession?.email) {
    if (getSession()?.email) restoreAuthenticatedShell();
    return;
  }
  const { path: hashPath, params: hashParams } = parseLocationHash();
  const hash = hashPath;

  if (!hash) {
    restoreAuthenticatedShell();
    switchView("dashboard");
    history.replaceState(null, "", "#dashboard");
    return;
  }

  const dealNavMatch = /^deals\/([^/?]+)$/.exec(hash);
  if (dealNavMatch) {
    selectedDealNavId = dealNavMatch[1];
    dealListTractionFilter = "";
    if (currentView !== "deals") {
      switchView("deals", { drillDown: true, dealId: dealNavMatch[1] });
    } else {
      void renderDealPanel();
    }
    return;
  }
  if (hash === "deals") {
    selectedDealNavId = null;
    dealListTractionFilter = hashParams.get("filter") || "";
    if (currentView !== "deals") {
      switchView("deals", { drillDown: !!dealListTractionFilter });
    } else {
      void renderDealPanel();
    }
    return;
  }

  const callMatch = /^calls\/([^/?]+)$/.exec(hash);
  if (callMatch) {
    selectedCallId = callMatch[1];
    callRecordTab = hashParams.get("tab") || undefined;
    callExpandThemeKey = hashParams.get("theme") || undefined;
    callRecordOwnerEmail = hashParams.get("owner")
      ? normalizeSeEmail(hashParams.get("owner"))
      : undefined;
    if (currentView !== "calls") {
      switchView("calls", { drillDown: true, callId: callMatch[1] });
    } else {
      void renderCallPanel();
    }
    return;
  }
  if (hash === "calls") {
    selectedCallId = null;
    callsListFilter = hashParams.get("filter") || "";
    if (currentView !== "calls") {
      switchView("calls", { drillDown: !!callsListFilter });
    } else {
      void renderCallPanel();
    }
    return;
  }

  const prepBriefMatch = /^precall\/briefs\/([^/?]+)$/.exec(hash);
  if (prepBriefMatch) {
    selectedPrepBriefId = prepBriefMatch[1];
    precallBriefListMode = true;
    if (currentView !== "precall") {
      switchView("precall", { drillDown: true, briefId: prepBriefMatch[1], briefList: true });
    } else {
      void renderPrecallPanel();
    }
    return;
  }
  if (hash === "precall/briefs") {
    selectedPrepBriefId = null;
    precallBriefListMode = true;
    if (currentView !== "precall") {
      switchView("precall", { drillDown: true, briefList: true });
    } else {
      void renderPrecallPanel();
    }
    return;
  }

  const topLevelViews = new Set([
    "dashboard",
    "coaching",
    "precall",
    "postcall",
    "accounts",
    "deals",
    "contacts",
    "manager",
    "pipeline",
    "signal",
    "profile",
  ]);
  if (topLevelViews.has(hash) && currentView !== hash) {
    switchView(hash);
  }
}

function openHistoryItem(id) {
  const record = getPostCallAnalysis(currentSession.email, id);
  if (!record?.result && !record?.analysis) return;
  openCallRecord(id);
}

function clearSidebarHistory() {
  clearSidebarRecentWork();
}

function refreshDashboardFromStorage() {
  refreshActiveDashboard();
}

function setSidebarHistorySyncing(on) {
  const el = $("sidebar-history-sync");
  if (el) show(el, on);
}

async function loadPersistedHistory() {
  if (!currentSession?.email) {
    clearSidebarHistory();
    return 0;
  }
  setSidebarHistorySyncing(true);
  try {
    const [list] = await Promise.all([
      syncHistoryOnLogin(currentSession.email),
      syncTasksOnLogin(currentSession.email),
    ]);
    await syncTasksAfterActivity(currentSession.email, { seName: currentSession.name });
    historyHydratedForEmail = currentSession.email;
    refreshSidebarHistory();
    const count = list.length;
    console.info(`[app] loaded ${count} post-call record(s) for ${currentSession.email}`);
    return count;
  } catch (err) {
    console.warn("[app] history sync failed:", err);
    refreshSidebarHistory();
    return listPostCallAnalyses(currentSession.email).length;
  } finally {
    setSidebarHistorySyncing(false);
  }
}

function openPrepBriefItem(id) {
  selectedPrepBriefId = null;
  precallBriefListMode = false;
  if (!openPrepBrief(id)) return;
  switchView("precall", { keepBrief: true });
  document.querySelectorAll(".sidebar-prep-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function clearSidebarRecentWork() {
  const prepList = $("sidebar-prep-list");
  const callList = $("sidebar-call-list");
  const prepEmpty = $("sidebar-prep-empty");
  const callEmpty = $("sidebar-call-empty");
  if (prepList) prepList.innerHTML = "";
  if (callList) callList.innerHTML = "";
  if (prepEmpty) show(prepEmpty, true);
  if (callEmpty) show(callEmpty, true);
}

function normalizeSidebarCompanyKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatSidebarDate(when) {
  const s = String(when || "").trim();
  return s ? s : "";
}

function sidebarBriefDedupeKey(b) {
  const domain = String(b.meta?.domain || b.meta?.companyDomain || "")
    .toLowerCase()
    .trim();
  if (domain) return `domain:${domain}`;
  const slug = String(b.meta?.company || b.company || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
  if (slug) return `slug:${slug}`;
  return normalizeSidebarCompanyKey(b.company);
}

function dedupeBriefsByCompany(briefs) {
  const seen = new Set();
  const out = [];
  for (const b of briefs || []) {
    const key = sidebarBriefDedupeKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

async function refreshSidebarRecentWork() {
  if (!currentSession?.email) {
    clearSidebarRecentWork();
    return;
  }

  const briefs = dedupeBriefsByCompany(loadLocalBriefs()).slice(0, 5);
  const calls = listPostCallAnalyses(currentSession.email).slice(0, 5);

  const prepList = $("sidebar-prep-list");
  const callList = $("sidebar-call-list");
  const prepEmpty = $("sidebar-prep-empty");
  const callEmpty = $("sidebar-call-empty");

  if (prepList) {
    if (!briefs.length) {
      prepList.innerHTML = "";
      show(prepEmpty, true);
    } else {
      show(prepEmpty, false);
      prepList.innerHTML = briefs
        .map(
          (b) => `<li>
        <fw-button class="sidebar-history-item sidebar-prep-item" color="secondary" fill="clear" data-id="${esc(b.id)}" title="${esc(b.company || "Brief")}">
          <span class="hist-title">${esc(b.company || "Account")}</span>
          <span class="hist-meta"><span class="hist-kind">${esc(b.kind || "Discovery")}</span><span class="hist-when">${esc(formatSidebarDate(b.when))}</span></span>
        </fw-button>
      </li>`,
        )
        .join("");
    }
  }

  if (callList) {
    if (!calls.length) {
      callList.innerHTML = "";
      show(callEmpty, true);
    } else {
      show(callEmpty, false);
      callList.innerHTML = calls
        .map((r) => {
          const when = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "";
          const qc = r.analysis?.qualityCoach;
          const score = qc ? normalizeQualityCoach(qc).overallScore : null;
          const scoreBadge = score != null ? `<span class="hist-score">${score}/10</span>` : "";
          return `<li>
        <fw-button class="sidebar-history-item sidebar-call-item" color="secondary" fill="clear" data-id="${esc(r.id)}" title="${esc(r.title)}">
          <span class="hist-title">${esc(r.title)}</span>
          <span class="hist-meta">${scoreBadge}<span class="hist-when">${esc(when)}</span></span>
        </fw-button>
      </li>`;
        })
        .join("");
    }
  }
}

function refreshSidebarHistory() {
  refreshSidebarRecentWork();
}

function refreshUserMenuFromSession() {
  refreshUserMenu(currentSession);
}

function wireUserMenu() {
  initUserMenu({
    getSession: () => currentSession,
    onProfileSettings: () => switchView("profile"),
    onSignOut: () => void handleSignOut(),
  });
}

let signingOut = false;

async function handleSignOut() {
  if (signingOut) return;
  signingOut = true;
  try {
    if (fb?.auth && fb?.signOut) {
      try {
        await fb.signOut(fb.auth);
      } catch {
        // ignore sign-out errors
      }
    }
    logout();
    handleSession(null);
  } finally {
    signingOut = false;
  }
}

// ---------- Sidebar mobile ----------

function openSidebar() {
  $("sidebar").classList.add("open");
  show($("sidebar-backdrop"), true);
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  show($("sidebar-backdrop"), false);
}

// ---------- Firestore prep history (when Firebase enabled) ----------

async function savePrep(input, prep, meta) {
  try {
    const user = fb.auth.currentUser;
    await fb.addDoc(fb.collection(fb.db, "preps"), {
      uid: user.uid,
      email: user.email,
      company: input.companyName,
      prospectEmail: input.prospectEmail,
      additionalContext: input.additionalContext || "",
      prep,
      createdAt: fb.serverTimestamp(),
    });
  } catch (err) {
    console.warn("Could not save to history:", err);
  }
}

// ---------- Auth UI ----------

function showLogin() {
  if (getSession()?.email && !signingOut) return;
  if (ssoInFlight) return;
  showAppInFlight = false;
  historyHydratedForEmail = null;
  show($("app-loading"), false);
  show($("login-view"), true);
  show($("app-shell"), false);
  currentSession = null;
  resetSessionGreeting();
  clearLocalStoreCache();
  invalidateSessionListCache();
  clearHistoryAuthGetter();
  clearTasksAuthGetter();
  clearSummariesAuthGetter();
  clearCallPayloadAuthGetter();
  setTimelineAuthGetter(null);
  clearProductSignalAuthGetter();
  clearSidebarHistory();
  onSessionCleared();
}

let showAppInFlight = false;
/** True while Google SSO popup is opening or completing — blocks premature logout. */
let ssoInFlight = false;
/** Short grace before clearing session on user===null (token-refresh flicker). */
const AUTH_NULL_GRACE_MS = 800;
/** @type {ReturnType<typeof setTimeout> | null} */
let authNullGraceTimer = null;

function clearAuthNullGrace() {
  if (authNullGraceTimer) {
    clearTimeout(authNullGraceTimer);
    authNullGraceTimer = null;
  }
}

function scheduleDefinitiveSignOut() {
  clearAuthNullGrace();
  authNullGraceTimer = setTimeout(() => {
    authNullGraceTimer = null;
    if (!shouldLogoutAfterNullCheck({
      liveFirebaseUser: fb?.auth?.currentUser ?? null,
      ssoInFlight,
      signingOut,
    })) {
      return;
    }
    logout();
  }, AUTH_NULL_GRACE_MS);
}

function setAppLoadingMessage(message) {
  const el = $("app-loading-message") || $("app-loading")?.querySelector(".app-loading-message");
  if (el) el.textContent = message;
}

function showAuthWaiting(message = "Waiting for Google sign-in…") {
  setAppLoadingMessage(message);
  show($("login-view"), false);
  show($("app-loading"), true);
}

function applySessionAuthGetters() {
  const tokenFn = isFirebaseAuthEnabled() && fb?.auth?.currentUser
    ? () => fb.auth.currentUser.getIdToken()
    : null;
  setHistoryAuthGetter(tokenFn);
  setTasksAuthGetter(tokenFn);
  setSummariesAuthGetter(tokenFn);
  setCallPayloadAuthGetter(tokenFn);
  setTimelineAuthGetter(tokenFn);
  setProductSignalAuthGetter(tokenFn);
  onSessionReady(currentSession, tokenFn);
  return tokenFn;
}

async function applyInitialRouteFromHash(enriched) {
  const defaultView = isManagerRole(enriched) ? "manager" : "dashboard";
  const { path: hashPath, params: hashParams } = parseLocationHash();
  const hash = hashPath;
  const hashAliases = {
    lifecycles: { view: "accounts" },
    coaching: { view: "coaching" },
    "dashboard/coaching": { view: "coaching" },
    team: { view: "manager" },
    analysis: { view: "postcall" },
    workspace: { view: "postcall" },
  };
  const alias = hashAliases[hash];
  if (alias) {
    switchView(alias.view);
    return;
  }

  const lifecycleMatch = /^lifecycles\/(.+)$/.exec(hash);
  if (lifecycleMatch) {
    const store = getStore();
    const lc = await store.getLifecycle(lifecycleMatch[1]);
    if (lc?.accountId) {
      selectedAccountId = lc.accountId;
      selectedAccountDealId = lc.dealId || null;
      switchView("accounts", { accountId: lc.accountId });
    } else {
      switchView("accounts");
    }
    return;
  }

  const seMatch = /^se\/(.+)$/.exec(hash);
  if (seMatch) {
    selectedSeEmail = normalizeSeEmail(decodeURIComponent(seMatch[1]));
    seExpandThemeKey = hashParams.get("theme") || undefined;
    switchView("se", { drillDown: true, targetEmail: selectedSeEmail, theme: seExpandThemeKey });
    return;
  }

  const dealNavMatch = /^deals\/([^/?]+)$/.exec(hash);
  if (dealNavMatch) {
    selectedDealNavId = dealNavMatch[1];
    dealListTractionFilter = "";
    switchView("deals", { drillDown: true, dealId: dealNavMatch[1] });
    return;
  }
  if (hash === "deals") {
    selectedDealNavId = null;
    dealListTractionFilter = hashParams.get("filter") || "";
    switchView("deals", { drillDown: !!dealListTractionFilter });
    return;
  }
  if (hash === "pipeline") {
    pipelineQuarterFilter = hashParams.get("quarter") || "";
    pipelineSubRegionFilter = hashParams.get("sub") || "";
    const sort = hashParams.get("sort");
    pipelineSortKey = sort === "arr" || sort === "mrr" ? sort : "agents";
    switchView("pipeline");
    return;
  }
  if (hash === "signal") {
    switchView("signal");
    return;
  }

  const callMatch = /^calls\/([^/?]+)$/.exec(hash);
  if (callMatch) {
    selectedCallId = callMatch[1];
    callRecordTab = hashParams.get("tab") || undefined;
    callExpandThemeKey = hashParams.get("theme") || undefined;
    callRecordOwnerEmail = hashParams.get("owner")
      ? normalizeSeEmail(hashParams.get("owner"))
      : undefined;
    switchView("calls", { drillDown: true });
    return;
  }
  if (hash === "calls") {
    selectedCallId = null;
    callsListFilter = hashParams.get("filter") || "";
    switchView("calls", { drillDown: !!callsListFilter });
    return;
  }

  const prepBriefMatch = /^precall\/briefs\/([^/?]+)$/.exec(hash);
  if (prepBriefMatch) {
    selectedPrepBriefId = prepBriefMatch[1];
    precallBriefListMode = true;
    switchView("precall", { drillDown: true, briefId: prepBriefMatch[1], briefList: true });
    return;
  }
  if (hash === "precall/briefs") {
    selectedPrepBriefId = null;
    precallBriefListMode = true;
    switchView("precall", { drillDown: true, briefList: true });
    return;
  }

  const accountDealMatch = /^accounts\/([^/]+)\/deals\/([^/]+)$/.exec(hash);
  if (accountDealMatch) {
    selectedAccountId = accountDealMatch[1];
    selectedAccountDealId = accountDealMatch[2];
    selectedAccountContactId = null;
    switchView("accounts", { accountId: selectedAccountId, drillDown: true });
    return;
  }

  const accountContactMatch = /^accounts\/([^/]+)\/contacts\/([^/]+)$/.exec(hash);
  if (accountContactMatch) {
    selectedAccountId = accountContactMatch[1];
    selectedAccountContactId = accountContactMatch[2];
    selectedAccountDealId = null;
    switchView("accounts", { accountId: selectedAccountId, drillDown: true });
    return;
  }

  const accountMatch = /^accounts\/([^/]+)$/.exec(hash);
  if (accountMatch) {
    selectedAccountId = accountMatch[1];
    selectedAccountDealId = null;
    selectedAccountContactId = null;
    switchView("accounts", { accountId: selectedAccountId, drillDown: true });
    return;
  }

  const valid = [
    "dashboard",
    "coaching",
    "precall",
    "postcall",
    "accounts",
    "deals",
    "contacts",
    "calls",
    "manager",
    "pipeline",
    "signal",
    "se",
    "profile",
  ];
  switchView(valid.includes(hash) ? hash : defaultView);
}

async function hydrateSessionAfterShow(session, sessionStillValid) {
  // Search index warm is deferred — see showApp. Sidebar refresh only.
  refreshSidebarRecentWork();
  refreshDashboardFromStorage();
}

async function showApp(session, opts = {}) {
  if (showAppInFlight) {
    if (opts.freshLogin) {
      while (showAppInFlight) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    } else {
      return;
    }
  }
  showAppInFlight = true;
  const expectedEmail = String(session?.email || "").trim().toLowerCase();
  const sessionStillValid = () => {
    const live = getSession();
    return !!(live?.email && String(live.email).trim().toLowerCase() === expectedEmail);
  };
  show($("app-loading"), true);
  show($("login-view"), false);
  show($("app-shell"), true);
  try {
    if (!sessionStillValid()) {
      show($("app-loading"), false);
      return;
    }

    currentSession = session?.email
      ? { ...session, email: String(session.email).trim().toLowerCase() }
      : session;
    refreshUserMenuFromSession();
    updateTopbarDate();

    if (opts.freshLogin) {
      resetSessionGreeting();
      triggerSignInPulse();
    }

    applySessionAuthGetters();

    if (opts.freshLogin) {
      void setFieldValue($("login-email"), "");
      void setFieldValue($("login-password"), "");
      void ensurePostCallProspectEmailsEmpty();
      scheduleProspectEmailAutofillGuard();
    }

    updateNavForRole();
    refreshSidebarRecentWork();

    applySessionAuthGetters();
    void loadPersistedHistory().catch((err) => {
      console.warn("[app] early history hydrate failed:", err?.message || err);
    });
    try {
      await applyInitialRouteFromHash(currentSession);
    } catch (err) {
      console.warn("[app] initial route failed:", err?.message || err);
      switchView(isManagerRole(currentSession) ? "manager" : "dashboard");
    }
    await paintAuthenticatedShell();

    void (async () => {
      if (!sessionStillValid()) return;
      try {
        /* DEV-ONLY-START */
        if (!prodBundle && !isFirebaseAuthEnabled()) {
          const { seedDevDomainIfNeeded } = await import("./domain/seed-dev.js");
          await seedDevDomainIfNeeded();
        }
        /* DEV-ONLY-END */
        const enriched = (await syncSessionWithDomainStore(session)) || session;
        if (!sessionStillValid()) return;
        if (enriched?.email) {
          currentSession = { ...enriched, email: String(enriched.email).trim().toLowerCase() };
          refreshUserMenuFromSession();
          updateNavForRole();
        }
        applySessionAuthGetters();
        await loadPersistedHistory();
        if (!sessionStillValid()) return;
        refreshSidebarRecentWork();
        if (currentView === "dashboard" || currentView === "manager" || currentView === "coaching") {
          refreshDashboardFromStorage();
        }
      } catch (err) {
        console.warn("[app] deferred session/history hydrate failed:", err?.message || err);
        refreshSidebarRecentWork();
      }
    })();

    setTimeout(() => warmSearchIndex(() => currentSession), 2000);

    void hydrateSessionAfterShow(session, sessionStillValid);
  } catch (err) {
    console.warn("[app] showApp failed:", err?.message || err);
  } finally {
    show($("app-loading"), false);
    const hasSession = !!getSession()?.email;
    const hasFirebaseUser = !!(fb?.auth?.currentUser);
    if (!hasSession && !hasFirebaseUser && !ssoInFlight && !signingOut) {
      show($("login-view"), true);
      show($("app-shell"), false);
      show($("app-loading"), false);
      setAppLoadingMessage("Loading your workspace…");
    } else if ((hasSession || hasFirebaseUser) && !signingOut) {
      show($("login-view"), false);
      show($("app-shell"), true);
    }
    showAppInFlight = false;
  }
}

function handleSession(session, opts = {}) {
  if (session) {
    ssoInFlight = false;
    void showApp(session, opts);
  } else {
    showLogin();
  }
}

let loginInFlight = false;

async function submitLogin(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (loginInFlight) return;
  loginInFlight = true;
  try {
    const errEl = $("login-error");
    show(errEl, false);

    const email = await readFieldValueAsync($("login-email"));
    const password = await readFieldValueAsync($("login-password"));

    if (!email || !password) {
      setFieldError($("login-email"), email ? "" : "Enter your email.");
      setFieldError($("login-password"), password ? "" : "Enter your password.");
      errEl.textContent = "Enter email and password.";
      show(errEl, true);
      return;
    }
    setFieldError($("login-email"));
    setFieldError($("login-password"));

    const result = await loginDummy(email, password, { persist: false });
    if (!result.ok) {
      setFieldError($("login-password"), result.error);
      errEl.textContent = result.error;
      show(errEl, true);
      return;
    }

    setSession(result.session, { freshLogin: true });

    void syncSessionWithDomainStore(result.session)
      .then((enriched) => {
        if (enriched) setSession(enriched, { notify: false });
      })
      .catch((err) => {
        console.warn("Domain store session sync failed after login:", err);
      });
  } catch (err) {
    const errEl = $("login-error");
    if (errEl) {
      errEl.textContent = err?.message || "Sign-in failed.";
      show(errEl, true);
    }
    throw err;
  } finally {
    loginInFlight = false;
  }
}

let loginHandlersWired = false;

function wireLoginHandlers() {
  if (loginHandlersWired) return;
  loginHandlersWired = true;

  $("login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void submitLogin(e);
  });
  $("login-submit")?.addEventListener("fwClick", (e) => {
    e?.preventDefault?.();
    void submitLogin(e);
  });
  $("login-password")?.addEventListener("fwInputEnter", (e) => {
    e?.preventDefault?.();
    void submitLogin(e);
  });
}

function initDummyAuth() {
  if (prodBundle || isFirebaseAuthEnabled()) return;
  if (customElements.get("fw-button")) {
    wireLoginHandlers();
  } else {
    customElements.whenDefined("fw-button").then(wireLoginHandlers);
  }

  const existing = getSession();
  if (existing) handleSession(existing);

  onSessionChange(handleSession);
}

// ---------- Firebase auth (optional) ----------

/** @type {Promise<object|null>|null} */
let firebaseLoginPromise = null;

async function completeFirebaseLogin(user, opts = {}) {
  if (firebaseLoginPromise) return firebaseLoginPromise;
  firebaseLoginPromise = (async () => {
    try {
      const hadSession = !!getSession();
      const base = sessionFromFirebaseUser(user);
      if (!base) return null;
      const fallbackId = stableUserIdForEmail(base.email);
      const quickSession = {
        ...base,
        userId: fallbackId,
        uid: fallbackId,
      };
      setSession(quickSession, { freshLogin: opts.freshLogin ?? !hadSession });

      try {
        const session = await persistFirebaseSession(user, { persist: false });
        const enriched = await syncSessionWithDomainStore(session || quickSession);
        setSession(enriched || session || quickSession, { notify: false });
        return enriched || session || quickSession;
      } catch (err) {
        console.warn("Firebase session enrich failed:", err?.message || err);
        return quickSession;
      }
    } finally {
      firebaseLoginPromise = null;
    }
  })();
  return firebaseLoginPromise;
}

function configureFirebaseLoginUi() {
  show($("login-form"), false);
  show($("login-hint"), false);
  const divider = $("login-or-divider");
  if (divider) divider.hidden = true;
  show($("firebase-signin-block"), true);
  show($("login-subtitle"), false);
}

function wireFirebaseSignIn(runSignIn) {
  const btn = $("signin-google");
  const attach = () => bindActionOnce(btn, () => {
    void runSignIn();
  });
  if (customElements.get("fw-button")) attach();
  else customElements.whenDefined("fw-button").then(attach);
}

/** @type {Promise<{ authMod: object, auth: object, provider: object }>|null} */
let firebaseSdkReady = null;
/** @type {import("firebase/auth").Auth|null} */
let firebaseAuth = null;
/** @type {import("firebase/auth").GoogleAuthProvider|null} */
let firebaseProvider = null;
let firebaseSignInWired = false;

function ensureFirebaseSdk() {
  if (!firebaseSdkReady) {
    firebaseSdkReady = (async () => {
      const [{ initializeApp }, authMod, fsMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
      ]);
      const app = initializeApp(firebaseConfig);
      firebaseAuth = authMod.getAuth(app);
      firebaseProvider = new authMod.GoogleAuthProvider();
      if (ALLOWED_EMAIL_DOMAIN) firebaseProvider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });

      fb = {
        auth: firebaseAuth,
        provider: firebaseProvider,
        signInWithPopup: authMod.signInWithPopup,
        signOut: authMod.signOut,
        db: fsMod.getFirestore(app),
        collection: fsMod.collection,
        addDoc: fsMod.addDoc,
        doc: fsMod.doc,
        getDoc: fsMod.getDoc,
        getDocs: fsMod.getDocs,
        setDoc: fsMod.setDoc,
        updateDoc: fsMod.updateDoc,
        deleteDoc: fsMod.deleteDoc,
        query: fsMod.query,
        where: fsMod.where,
        orderBy: fsMod.orderBy,
        limit: fsMod.limit,
        documentId: fsMod.documentId,
        select: fsMod.select,
        serverTimestamp: fsMod.serverTimestamp,
        writeBatch: fsMod.writeBatch,
      };

      initDomainStore(fb);

      try {
        await authMod.setPersistence(firebaseAuth, authMod.browserLocalPersistence);
      } catch (err) {
        console.warn("[app] setPersistence failed, using default:", err?.message || err);
      }

      return { authMod, auth: firebaseAuth, provider: firebaseProvider };
    })();
  }
  return firebaseSdkReady;
}

async function runFirebaseSignIn() {
  if (ssoInFlight) return;
  ssoInFlight = true;
  const btn = $("signin-google");
  show($("signin-error"), false);
  setButtonLoading(btn, true);
  showAuthWaiting("Preparing Google sign-in…");
  try {
    await ensureFirebaseSdk();
    showAuthWaiting("Opening Google sign-in…");
    await fb.signInWithPopup(firebaseAuth, firebaseProvider);
    showAuthWaiting("Completing sign-in…");
    const popupUser = fb.auth.currentUser;
    if (popupUser) {
      await completeFirebaseLogin(popupUser, { freshLogin: !getSession()?.email });
    }
  } catch (err) {
    const e = $("signin-error");
    if (e) {
      e.textContent = err?.message || "Sign-in failed.";
      show(e, true);
    }
    show($("app-loading"), false);
    show($("login-view"), true);
    setAppLoadingMessage("Loading your workspace…");
  } finally {
    setButtonLoading(btn, false);
    ssoInFlight = false;
  }
}

function ensureFirebaseSignInWired() {
  if (firebaseSignInWired || !isFirebaseAuthEnabled()) return;
  firebaseSignInWired = true;
  configureFirebaseLoginUi();
  wireFirebaseSignIn(runFirebaseSignIn);
}

async function initFirebase() {
  ensureFirebaseSignInWired();

  const { authMod } = await ensureFirebaseSdk();
  const auth = firebaseAuth;

  let authResolved = false;
  const authReady = auth.authStateReady
    ? auth.authStateReady().catch(() => {})
    : new Promise((resolve) => {
        const stop = authMod.onAuthStateChanged(auth, () => { stop(); resolve(); });
      });
  authReadyPromise = authReady.then(() => { authResolved = true; });

  authMod.onAuthStateChanged(auth, (user) => {
    const allowed =
      user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`));
    if (allowed) {
      clearAuthNullGrace();
      if (!signingOut) void completeFirebaseLogin(user);
      return;
    }
    if (user) {
      clearAuthNullGrace();
      fb.signOut(auth);
      logout();
      return;
    }
    // user === null: unresolved = wait; SSO in flight = defer; resolved + still null = sign out.
    if (shouldDeferNullAuth({ authResolved, ssoInFlight, signingOut })) return;
    scheduleDefinitiveSignOut();
  });

  onSessionChange(handleSession);

  firebaseBootstrapPromise = authReady.then(async () => {
    const user = fb.auth.currentUser;
    const existing = getSession();
    if (user) {
      clearAuthNullGrace();
      if (sessionMatchesFirebaseUser(existing, user)) {
        if (existing) handleSession(existing, { restored: true });
        void completeFirebaseLogin(user, { restored: true });
        return;
      }
      if (existing?.email) logout();
      await completeFirebaseLogin(user, { restored: true });
      return;
    }
    // Auth resolved with no Firebase user — cached session is not valid auth evidence.
    if (existing?.email) logout();
    if (!showAppInFlight && !ssoInFlight) showLogin();
  });
}

async function warnIfWorkerDown() {
  const banner = $("worker-warning");
  if (!banner) return true;
  const configUrl = `${WORKER_BASE_URL}/api/config`;
  const portalBuild =
    document.querySelector('meta[name="portal-build"]')?.getAttribute("content") || "";
  try {
    const res = await fetch(configUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const config = await res.json();
    const workerBuild = String(config.workerBuild || "");
    const schemaFix = config.geminiSchemaEnumFix || null;
    if (!schemaFix) {
      banner.setAttribute("type", "warning");
      banner.textContent =
        `Worker missing schema fix (workerBuild: ${workerBuild || "unknown"}). ` +
        "Rebuild worker from branch with geminiSchemaEnumFix, or run deploy without git reset --hard.";
      banner.hidden = false;
      return true;
    }
    const speedFixRelease = (build) =>
      /(?:^|[^0-9])2\.1(?:\.|$|-)/.test(String(build || "")) ||
      build.includes("domain-cache") ||
      build.includes("precall-align") ||
      build.includes("2.0.8.1");
    const needsDomainCache =
      !!portalBuild && !(speedFixRelease(portalBuild) && speedFixRelease(workerBuild));
    if (needsDomainCache) {
      banner.setAttribute("type", "warning");
      banner.textContent =
        `Speed fixes not deployed (portal: ${portalBuild || "unknown"}, worker: ${workerBuild || "missing"}). ` +
        "On VPS run: cd /opt/se-singha-paathai/deploy/vps && bash update.sh";
      banner.hidden = false;
      return true;
    }
    banner.hidden = true;
    return true;
  } catch (err) {
    const status = err?.status;
    const errName = err?.name || "Error";
    banner.setAttribute("type", "error");
    banner.textContent = workerDownMessage(status, errName);
    banner.hidden = false;
    return false;
  }
}

/** Re-check while worker is down (e.g. user starts worker in a second terminal). */
function startWorkerHealthMonitoring() {
  let timerId = null;
  const schedule = (workerUp) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(async () => {
      const up = await warnIfWorkerDown();
      schedule(up);
    }, workerUp ? 60_000 : 5_000);
  };
  void warnIfWorkerDown().then(schedule);
}

async function boot() {
  restoreAuthenticatedShell();
  const bootSession = getSession();
  if (bootSession?.email) {
    currentSession = { ...bootSession, email: String(bootSession.email).trim().toLowerCase() };
    void loadPersistedHistory().catch((err) => {
      console.warn("[app] boot history prefetch failed:", err?.message || err);
    });
  }
  assertThemeScoreSuppressionReady();
  await loadFirebaseConfig();
  if (authMode() === "firebase") {
    ensureFirebaseSignInWired();
  }

  initSidebar();
  wireUserMenu();
  updateTopbarDate();
  initGlobalSearch({
    getSession: () => withEffectiveUserId(currentSession || getSession()),
    switchView,
    openPrepBriefItem,
    openHistoryItem,
  });
  initFeedback({
    workerUrl: WORKER_BASE_URL,
    getEmail: () => currentSession?.email || "",
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
  });
  initPrepDisputes({
    workerUrl: WORKER_BASE_URL,
    getEmail: () => currentSession?.email || "",
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
  });
  initPrecall({
    researchUrl: PREP_RESEARCH_URL,
    synthesizeUrl: PREP_SYNTHESIZE_URL,
    enrichUrl: CONTACT_ENRICH_URL,
    kaiaShareUrl: KAIA_SHARE_CONTENT_URL,
    fetchKaiaUrl: FETCH_KAIA_SUMMARY_URL,
    authEnabled: isFirebaseAuthEnabled(),
    workerDownMsg: workerDownMessage(),
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
    onBackToBriefsList: backToBriefsList,
    switchView,
    onGenerated: async (payload, prep, meta) => {
      let lifecycleId = null;
      if (sessionUserId(currentSession) && currentSession?.teamId) {
        try {
          const linked = await linkPrepToLifecycle(currentSession, payload, prep, meta);
          lifecycleId = linked?.lifecycle?.id || null;
        } catch (err) {
          console.warn("Lifecycle dual-write (prep) failed:", err);
        }
      }
      if (currentSession?.email) {
        void syncTasksAfterActivity(currentSession.email, {
          seName: currentSession.name,
          prepResult: prep,
          company: payload.companyName,
          lifecycleId,
          session: currentSession,
        }).then(() => {
          if (currentView === "dashboard") refreshDashboardFromStorage();
        });
      }
      if (isFirebaseAuthEnabled() && fb?.auth?.currentUser) await savePrep(payload, prep, meta);
      invalidateSessionListCache(currentSession);
      if (currentView === "dashboard") refreshDashboardFromStorage();
      if (currentView === "accounts") void renderAccountPanel();
      if (currentView === "deals") void renderDealPanel();
      if (currentView === "calls") void renderCallPanel();
      invalidateSearchIndex();
      warmSearchIndex(() => currentSession);
      await refreshSidebarRecentWork();
      return lifecycleId;
    },
  });
  initPostcall();
  setOnCallRecordReady((id) => openCallRecord(id));
  setOnCallRecordHydrated((id) => {
    scheduleCallRecordPanelRefresh(id, { immediate: true });
  });
  window.addEventListener("lionpath:call-record-updated", (ev) => {
    const id = ev.detail?.id;
    scheduleCallRecordPanelRefresh(id);
  });
  window.addEventListener("lionpath:call-record-progress", (ev) => {
    const id = ev.detail?.id;
    const message = ev.detail?.message;
    if (selectedCallId !== id || currentView !== "calls") return;
    const label = document.querySelector(
      "#call-panel .call-record-inline-progress .postcall-inline-progress-label",
    );
    if (label && message != null) {
      label.textContent = message;
      label.closest(".call-record-inline-progress")?.toggleAttribute("hidden", !message);
    } else if (message) {
      void renderCallPanel();
    }
  });

  document.querySelectorAll("#prep-form fw-input, #prep-form fw-textarea, #postcall-form fw-input, #postcall-form fw-textarea").forEach((el) => fillShadowField(el));

  $("prospectEmail")?.addEventListener("fwInput", onProspectEmailInput);
  $("prospectEmail")?.addEventListener("input", onProspectEmailInput);
  $("prospectEmail")?.addEventListener("fwBlur", onProspectEmailBlur);
  $("prospectEmail")?.addEventListener("blur", onProspectEmailBlur);

  $("topbar-new-brief")?.addEventListener("click", () => {
    precallBriefListMode = false;
    selectedPrepBriefId = null;
    resetPrecallForm();
    switchView("precall");
  });
  $("topbar-new-call")?.addEventListener("click", () => switchView("postcall"));
  $("topbar-notifications")?.addEventListener("click", () => {
    /* notifications placeholder — empty for now */
  });

  $("companyDomain")?.addEventListener("fwInput", onCompanyDomainInput);

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("fwClick", () => switchView(btn.dataset.view));
  });

  window.addEventListener("hashchange", () => applyRouteFromHash());
  window.addEventListener("popstate", () => {
    if (!getSession()?.email) return;
    restoreAuthenticatedShell();
    applyRouteFromHash();
  });
  window.addEventListener("pageshow", (ev) => {
    if (!ev.persisted) return;
    const session = getSession();
    if (!session?.email) return;
    show($("login-view"), false);
    show($("app-shell"), true);
    if (!currentSession?.email) handleSession(session, { restored: true });
    else void paintAuthenticatedShell();
  });
  $("sidebar-toggle")?.addEventListener("fwClick", openSidebar);
  $("sidebar-close")?.addEventListener("fwClick", closeSidebar);
  $("sidebar-backdrop").onclick = closeSidebar;

  $("sidebar-prep-list")?.addEventListener("fwClick", (e) => {
    const btn = e.target?.closest?.(".sidebar-prep-item");
    if (btn?.dataset?.id) openPrepBriefItem(btn.dataset.id);
  });
  $("sidebar-call-list")?.addEventListener("fwClick", (e) => {
    const btn = e.target?.closest?.(".sidebar-call-item");
    if (btn?.dataset?.id) openHistoryItem(btn.dataset.id);
  });

  setOnAnalysisSaved(async (record, payload, data) => {
    let linked = null;
    let session = currentSession;
    try {
      session = (await syncSessionWithDomainStore(currentSession)) || currentSession;
    } catch (err) {
      console.warn("[postcall] session sync before dual-write failed:", err?.message || err);
    }
    if (sessionUserId(session) && session?.teamId) {
      try {
        linked = await linkPostCallToLifecycle(session, payload, data, record);
      } catch (err) {
        console.warn("Lifecycle dual-write (post-call) failed:", err);
      }
    }
    // Dual-write may create the deal when confirm had none — stamp it onto history
    // so Open deal / deal strip work on the call view that opens next.
    const linkedDealId = linked?.lifecycle?.dealId || linked?.postCall?.dealId || null;
    if (linkedDealId && currentSession?.email && record?.id) {
      try {
        const { updatePostCallAnalysis } = await import("./history.js");
        await updatePostCallAnalysis(currentSession.email, record.id, (rec) => {
          rec.dealId = linkedDealId;
          if (linked?.accountId) rec.accountId = linked.accountId;
          if (data?.scorecard?.lines?.length && !rec.scorecard?.lines?.length) {
            rec.scorecard = data.scorecard;
          }
          if (rec.result) {
            rec.result = {
              ...rec.result,
              confirmed: {
                ...(rec.result.confirmed || {}),
                dealId: linkedDealId,
                accountId: linked?.accountId || rec.result.confirmed?.accountId || null,
              },
            };
          }
          return rec;
        });
        record.dealId = linkedDealId;
      } catch (err) {
        console.warn("[app] dealId write-back failed:", err?.message || err);
      }
    }
    // Paint sidebar immediately — do not wait for remote history sync.
    refreshSidebarRecentWork();
    try {
      await loadPersistedHistory();
      if (currentSession?.email) {
        await syncTasksAfterActivity(currentSession.email, { seName: currentSession.name });
      }
      if (currentView === "dashboard" || currentView === "manager" || currentView === "pipeline" || currentView === "accounts") {
        refreshDashboardFromStorage();
      }
      if (currentView === "accounts") void renderAccountPanel();
      if (currentView === "deals") void renderDealPanel();
      if (currentView === "calls") void renderCallPanel();
      if (currentView === "pipeline") void renderPipelinePanel();
      if (currentView === "signal") void renderProductSignalPanel();
      invalidateSearchIndex();
      invalidateSessionListCache(currentSession);
      warmSearchIndex(() => currentSession);
      refreshSidebarRecentWork();
    } catch (err) {
      console.warn("[app] post-call history refresh failed:", err?.message || err);
      refreshSidebarRecentWork();
    }
  });

  initDomainStore(null);

  if (authMode() === "firebase") {
    await initFirebase();
    await authReadyPromise;
    await firebaseBootstrapPromise;
    const bootDeadline = Date.now() + 8000;
    while (showAppInFlight && Date.now() < bootDeadline) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!getSession() && !showAppInFlight && !ssoInFlight && !fb?.auth?.currentUser) showLogin();
    else if (getSession()?.email && currentView === "dashboard" && !isManagerRole(currentSession)) {
      void loadPersistedHistory().then(() => refreshDashboardFromStorage());
    }
  } else {
    initDummyAuth();
    await authReadyPromise;
    const existing = getSession();
    if (!existing && !showAppInFlight) showLogin();
  }

  startWorkerHealthMonitoring();
}

void boot().catch((err) => {
  console.error("App boot failed:", err);
  const errEl = $("login-error");
  if (errEl) {
    errEl.textContent = `App failed to start: ${err?.message || err}. Hard-refresh (Ctrl+Shift+R) and try again.`;
    show(errEl, true);
  }
});

if (typeof document !== "undefined" && isFirebaseAuthEnabled()) {
  const wireOnDom = () => ensureFirebaseSignInWired();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireOnDom);
  } else {
    wireOnDom();
  }
}
