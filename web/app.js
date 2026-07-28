import { readFieldValue, readFieldValueAsync, setFieldError } from "./crayons-ui.js";
import { triggerSignInPulse } from "./lion-roar.js";
import { initSidebar } from "./sidebar.js";
import { initFeedback } from "./feedback.js";
import { initPrepDisputes } from "./prep-disputes.js?v=dispute-static-v11";
import {
  authMode,
  getSession,
  loginDummy,
  logout,
  onSessionChange,
  persistFirebaseSession,
  isManagerRole,
  syncSessionWithDomainStore,
  setSession,
  isFirebaseAuthEnabled,
  sessionUserId,
  withEffectiveUserId,
} from "./auth.js";
import { initDomainStore, getStore } from "./domain/store.js";
import { clearLocalStoreCache } from "./domain/local-store.js";
import { seedDevDomainIfNeeded } from "./domain/seed-dev.js";
import { linkPrepToLifecycle, linkPostCallToLifecycle } from "./domain/dual-write.js";
import { renderAccountView } from "./account-view.js?v=accounts-mock-v1";
import { renderDealView } from "./deal-view.js";
import { renderCallView } from "./call-view.js?v=call-notes-bullets-3";
import { renderCallsListView } from "./calls-list-view.js";
import { initGlobalSearch, invalidateSearchIndex } from "./global-search.js";
import { listPostCallAnalyses, getPostCallAnalysis, syncHistoryOnLogin, setHistoryAuthGetter, clearHistoryAuthGetter } from "./history.js";
import {
  syncTasksOnLogin,
  syncTasksAfterActivity,
  setTasksAuthGetter,
  clearTasksAuthGetter,
} from "./tasks.js";
import { setSummariesAuthGetter, clearSummariesAuthGetter } from "./domain/summaries-service.js";
import { setTimelineAuthGetter } from "./domain/timeline-service.js";
import {
  setProductSignalAuthGetter,
  clearProductSignalAuthGetter,
} from "./domain/product-signal-service.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { assertThemeScoreSuppressionReady } from "./theme-score-suppression.js";
import { renderDashboard, renderManagerDashboard, buildTeamThemeAverages } from "./dashboard.js";
import { renderCoaching } from "./coaching.js";
import { renderSeDetailView } from "./se-detail-view.js";
import { renderPipelineView } from "./pipeline-view.js";
import { renderProductSignalView } from "./product-signal-view.js";
import { canSessionReadAccount, normalizeSeEmail } from "./domain/se-access-service.js";
import { initUserMenu, refreshUserMenu } from "./user-menu.js";
import { renderProfileSettings } from "./profile-settings.js";
import { firebaseConfig, WORKER_BASE_URL, ALLOWED_EMAIL_DOMAIN, loadFirebaseConfig } from "./firebase-config.js";
import {
  initPrecall,
  loadLocalBriefs,
  openPrepBrief,
  parseProspectEmails,
  syncPrepEngagementMotion,
} from "./precall.js?v=dispute-static-v14";
import {
  initPostcall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
  setOnCallRecordReady,
} from "./postcall.js";
import {
  applyAutoCompanyDomain,
  domainFromFirstProspectEmail,
  PERSONAL_EMAIL_DOMAINS,
  normalizeCompanyDomain as normalizePrepDomain,
} from "./prep-domain.js";
import { esc, $, show } from "./shared.js";


const PREP_RESEARCH_URL = `${WORKER_BASE_URL}/api/prep/research`;
const PREP_SYNTHESIZE_URL = `${WORKER_BASE_URL}/api/prep/synthesize`;
const CONTACT_ENRICH_URL = `${WORKER_BASE_URL}/api/contact/enrich`;
const KAIA_SHARE_CONTENT_URL = `${WORKER_BASE_URL}/api/kaia/share-content`;
const FETCH_KAIA_SUMMARY_URL = `${WORKER_BASE_URL}/api/fetch-kaia-summary`;
const DASH_TAB_STORAGE_KEY = "lionpath-dashboard-tab";
const WORKER_DOWN_MSG =
  `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
  "Start the worker: from the web folder run `npm run dev:all` (worker + web), or open a second terminal: `cd worker && npm run dev` (wait for Ready on port 8787). " +
  "Use the same hostname for both (localhost or 127.0.0.1 — not mixed). The banner clears automatically when the worker comes up.";

let fb = null;
let currentSession = null;
let currentView = "dashboard";
let currentDashTab = "overview";

const VIEW_TITLES = {
  dashboard: "My dashboard",
  precall: "Pre-call",
  postcall: "Post-call",
  accounts: "Accounts",
  deals: "My deals",
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
let dealListSearchQuery = "";
let dealListSortKey = "traction";
let pipelineQuarterFilter = "";
let pipelineSubRegionFilter = "";
let pipelineSortKey = "agents";

/** Selected call when viewing call record (#calls/:id) */
let selectedCallId = null;
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

/** Tracks manual edits vs auto-filled company domain on pre-call form. */
const prepDomainState = { userEdited: false, lastAutoValue: null };

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
    hints.push(`Possible typo — did you mean ${suggested}?`);
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

function syncAutoCompanyDomain() {
  const domainField = $("companyDomain");
  if (!domainField) return;
  const domainRaw = readFieldValue(domainField);
  if (!String(domainRaw || "").trim()) {
    prepDomainState.userEdited = false;
    prepDomainState.lastAutoValue = null;
  }
  const emailsRaw = readFieldValue($("prospectEmail"));
  const result = applyAutoCompanyDomain(domainField, emailsRaw, prepDomainState);
  if (result.lastAutoValue != null) prepDomainState.lastAutoValue = result.lastAutoValue;
}

function onCompanyDomainInput() {
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
  const companyName = readFieldValue($("companyName"));
  const companyDomain = normalizeCompanyDomainField(readFieldValue($("companyDomain")));
  const emailsRaw = readFieldValue($("prospectEmail"));
  const emailMsg = validateProspectDomain(emailsRaw, companyName);
  const hints = [];
  if (emailMsg) hints.push(emailMsg);
  const inferred = domainFromFirstProspectEmail(emailsRaw);
  const firstDomain = normalizePrepDomain(emailDomain(emailsRaw));
  if (!companyDomain && firstDomain && PERSONAL_EMAIL_DOMAINS.has(firstDomain)) {
    hints.push("Enter company website — we can't infer it from a personal email (Gmail, Outlook, etc.).");
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

function getStoredDashTab() {
  const t = localStorage.getItem(DASH_TAB_STORAGE_KEY);
  return t === "coaching" ? "coaching" : "overview";
}

function setStoredDashTab(tab) {
  localStorage.setItem(DASH_TAB_STORAGE_KEY, tab);
}

function switchDashboardTab(tab) {
  const normalized = tab === "coaching" ? "coaching" : "overview";
  currentDashTab = normalized;

  const dashTabs = $("dash-tabs");
  if (dashTabs && dashTabs.activeTabName !== normalized) {
    dashTabs.activeTabName = normalized;
  }

  setStoredDashTab(normalized);

  if (currentView === "dashboard" && currentSession?.email && !isManagerRole(currentSession)) {
    void renderDashboardPanels(currentSession.email, dashboardOpts());
  }

  if (currentView === "dashboard") {
    const hashBase = normalized === "coaching" ? "dashboard/coaching" : "dashboard";
    history.replaceState(null, "", `#${hashBase}`);
  }
}

function buildFetchRemotePreps() {
  if (!isFirebaseAuthEnabled() || !fb?.auth?.currentUser || !fb?.db) return undefined;
  return async () => {
    const user = fb.auth.currentUser;
    const q = fb.query(fb.collection(fb.db, "preps"), fb.where("uid", "==", user.uid));
    const snap = await fb.getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      const when = data.createdAt?.toDate?.()?.toLocaleDateString?.() || "";
      return { id: d.id, company: data.company, when };
    });
  };
}

function dashboardOpts() {
  return {
    seName: currentSession?.name,
    fetchRemotePreps: buildFetchRemotePreps(),
    onOpenCall: (id, callOpts = {}) => openCallRecord(id, callOpts),
    onPrep: () => {
      switchView("precall");
    },
    onAnalyze: () => {
      switchView("postcall");
    },
    onCoaching: () => {
      switchView("dashboard", { dashTab: "coaching" });
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
  await renderDashboard($("dash-tab-overview"), email, opts);
  renderCoaching($("dash-tab-coaching"), email, {
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
    opts = { dashTab: "coaching", ...opts };
    name = "dashboard";
  }
  name = normalizeViewName(name);
  currentView = name;
  const isManager = isManagerRole(currentSession);
  const panels = {
    dashboard: $("view-dashboard"),
    precall: $("view-precall"),
    postcall: $("view-postcall"),
    accounts: $("view-accounts"),
    deals: $("view-deals"),
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
    const view = btn.dataset.view;
    const active =
      view === name ||
      (view === "coaching" && name === "dashboard" && currentDashTab === "coaching");
    btn.classList.toggle("active", active);
  });

  if (name === "dashboard" && !isManager) {
    const dashTab = opts.dashTab || currentDashTab || getStoredDashTab();
    switchDashboardTab(dashTab);
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
    if (opts.accountId) selectedAccountId = opts.accountId;
    void renderAccountPanel();
  } else if (name === "deals") {
    if (opts.dealId) selectedDealNavId = opts.dealId;
    void renderDealPanel();
  } else if (name === "calls") {
    if (opts.callId) selectedCallId = opts.callId;
    else if (!opts.drillDown) selectedCallId = null;
    if (opts.callTab) callRecordTab = opts.callTab;
    if (opts.expandTheme) callExpandThemeKey = opts.expandTheme;
    if (opts.ownerEmail) callRecordOwnerEmail = opts.ownerEmail;
    if (opts.listFilter) callsListFilter = opts.listFilter;
    $("main-view-title").textContent = selectedCallId ? "Call record" : VIEW_TITLES.calls;
    void renderCallPanel();
  }

  const hash =
    name === "dashboard" && currentDashTab === "coaching"
      ? "dashboard/coaching"
      : name === "se"
        ? seDetailHash()
        : name === "accounts" && selectedAccountId
          ? accountDetailHash()
          : name === "deals"
            ? dealDetailHash()
            : name === "calls"
              ? callDetailHash()
              : name === "pipeline"
                ? pipelineHash()
                : name;
  history.replaceState(null, "", `#${hash}`);
  closeSidebar();
  if (name === "precall") {
    syncPrepEngagementMotion();
  }
}

async function renderAccountPanel() {
  const panel = $("account-panel");
  if (!panel || !currentSession?.email) return;
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
      switchView("accounts", { accountId: id });
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
  });
}

async function renderCallPanel() {
  const panel = $("call-panel");
  if (!panel || !currentSession?.email) return;
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
      onBack: () => {
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("calls", { drillDown: true });
      },
      onOpenDeal: (dealId) => {
        selectedDealNavId = dealId;
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("deals", { dealId, drillDown: true });
      },
      onOpenAccount: (accountId) => {
        selectedAccountId = accountId;
        selectedAccountDealId = null;
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
        switchView("accounts", { accountId, drillDown: true });
      },
      onRerun: () => {
        selectedCallId = null;
        callRecordTab = undefined;
        callExpandThemeKey = undefined;
        callRecordOwnerEmail = undefined;
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
  if (!openPrepBrief(id)) return;
  switchView("precall");
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

async function handleSignOut() {
  if (fb?.auth && fb?.signOut) {
    try {
      await fb.signOut(fb.auth);
    } catch {
      // ignore sign-out errors
    }
  }
  logout();
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
  show($("app-loading"), false);
  show($("login-view"), true);
  show($("app-shell"), false);
  currentSession = null;
  clearLocalStoreCache();
  clearHistoryAuthGetter();
  clearTasksAuthGetter();
  clearSummariesAuthGetter();
  setTimelineAuthGetter(null);
  clearProductSignalAuthGetter();
  clearSidebarHistory();
  onSessionCleared();
}

let showAppInFlight = false;

async function showApp(session, opts = {}) {
  if (showAppInFlight) return;
  showAppInFlight = true;
  show($("app-loading"), true);
  try {
    let enriched = session;
    try {
      await seedDevDomainIfNeeded();
      enriched = (await syncSessionWithDomainStore(session)) || session;
    } catch (err) {
      console.warn("Domain store session sync failed:", err);
    }

    currentSession = enriched?.email
      ? { ...enriched, email: String(enriched.email).trim().toLowerCase() }
      : enriched;
    show($("login-view"), false);
    show($("app-shell"), true);
    refreshUserMenuFromSession();

    if (opts.freshLogin) {
      triggerSignInPulse();
    }

    const tokenFn = isFirebaseAuthEnabled() && fb?.auth?.currentUser
      ? () => fb.auth.currentUser.getIdToken()
      : null;
    setHistoryAuthGetter(tokenFn);
    setTasksAuthGetter(tokenFn);
    setSummariesAuthGetter(tokenFn);
    setTimelineAuthGetter(tokenFn);
    setProductSignalAuthGetter(tokenFn);
    onSessionReady(currentSession, tokenFn);

    updateNavForRole();

    const defaultView = isManagerRole(enriched) ? "manager" : "dashboard";
    const { path: hashPath, params: hashParams } = parseLocationHash();
    const hash = hashPath;
    const hashAliases = {
      lifecycles: { view: "accounts" },
      coaching: { view: "dashboard", dashTab: "coaching" },
      "dashboard/coaching": { view: "dashboard", dashTab: "coaching" },
      team: { view: "manager" },
      analysis: { view: "postcall" },
      workspace: { view: "postcall" },
    };
    const alias = hashAliases[hash];
    if (alias) {
      switchView(alias.view, { dashTab: alias.dashTab });
    } else {
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
      } else {
        const seMatch = /^se\/(.+)$/.exec(hash);
        if (seMatch) {
          selectedSeEmail = normalizeSeEmail(decodeURIComponent(seMatch[1]));
          seExpandThemeKey = hashParams.get("theme") || undefined;
          switchView("se", { drillDown: true, targetEmail: selectedSeEmail, theme: seExpandThemeKey });
        } else {
          const dealNavMatch = /^deals\/([^/?]+)$/.exec(hash);
          if (dealNavMatch) {
            selectedDealNavId = dealNavMatch[1];
            dealListTractionFilter = "";
            switchView("deals", { drillDown: true });
          } else if (hash === "deals") {
            selectedDealNavId = null;
            dealListTractionFilter = hashParams.get("filter") || "";
            switchView("deals", { drillDown: !!dealListTractionFilter });
          } else if (hash === "pipeline") {
            pipelineQuarterFilter = hashParams.get("quarter") || "";
            pipelineSubRegionFilter = hashParams.get("sub") || "";
            const sort = hashParams.get("sort");
            pipelineSortKey = sort === "arr" || sort === "mrr" ? sort : "agents";
            switchView("pipeline");
          } else if (hash === "signal") {
            switchView("signal");
          } else {
            const callMatch = /^calls\/([^/?]+)$/.exec(hash);
            if (callMatch) {
              selectedCallId = callMatch[1];
              callRecordTab = hashParams.get("tab") || undefined;
              callExpandThemeKey = hashParams.get("theme") || undefined;
              callRecordOwnerEmail = hashParams.get("owner")
                ? normalizeSeEmail(hashParams.get("owner"))
                : undefined;
              switchView("calls", { drillDown: true });
            } else if (hash === "calls") {
              selectedCallId = null;
              callsListFilter = hashParams.get("filter") || "";
              switchView("calls", { drillDown: !!callsListFilter });
            } else {
              const accountDealMatch = /^accounts\/([^/]+)\/deals\/([^/]+)$/.exec(hash);
              if (accountDealMatch) {
                selectedAccountId = accountDealMatch[1];
                selectedAccountDealId = accountDealMatch[2];
                selectedAccountContactId = null;
                switchView("accounts", { accountId: selectedAccountId, drillDown: true });
              } else {
                const accountContactMatch = /^accounts\/([^/]+)\/contacts\/([^/]+)$/.exec(hash);
                if (accountContactMatch) {
                  selectedAccountId = accountContactMatch[1];
                  selectedAccountContactId = accountContactMatch[2];
                  selectedAccountDealId = null;
                  switchView("accounts", { accountId: selectedAccountId, drillDown: true });
                } else {
                  const accountMatch = /^accounts\/([^/]+)$/.exec(hash);
                  if (accountMatch) {
                    selectedAccountId = accountMatch[1];
                    selectedAccountDealId = null;
                    selectedAccountContactId = null;
                    switchView("accounts", { accountId: selectedAccountId, drillDown: true });
                  } else {
                    const valid = [
                      "dashboard",
                      "precall",
                      "postcall",
                      "accounts",
                      "deals",
                      "calls",
                      "manager",
                      "pipeline",
                      "signal",
                      "se",
                      "profile",
                    ];
                    switchView(valid.includes(hash) ? hash : defaultView, {
                      dashTab: hash === "dashboard" ? getStoredDashTab() : undefined,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
    await loadPersistedHistory();
  } finally {
    show($("app-loading"), false);
    showAppInFlight = false;
  }
}

function handleSession(session, opts = {}) {
  if (session) void showApp(session, opts);
  else showLogin();
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

    const result = loginDummy(email, password, { persist: false });
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

let firebaseLoginInFlight = false;

async function completeFirebaseLogin(user, opts = {}) {
  if (firebaseLoginInFlight) return;
  firebaseLoginInFlight = true;
  try {
    const hadSession = !!getSession();
    const session = await persistFirebaseSession(user, { persist: false });
    if (!session) return;
    const enriched = await syncSessionWithDomainStore(session);
    setSession(enriched || session, { freshLogin: opts.freshLogin ?? !hadSession });
  } finally {
    firebaseLoginInFlight = false;
  }
}

function configureFirebaseLoginUi() {
  show($("login-form"), false);
  show($("login-hint"), false);
  const divider = $("firebase-signin-block")?.querySelector(".or-divider");
  if (divider) divider.hidden = true;
  show($("firebase-signin-block"), true);
  const subtitle = $("login-subtitle");
  if (subtitle) {
    subtitle.textContent = "Sign in with your @freshworks.com Google account.";
  }
}

async function initFirebase() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const provider = new authMod.GoogleAuthProvider();
  if (ALLOWED_EMAIL_DOMAIN) provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });

  fb = {
    auth, provider,
    signInWithPopup: authMod.signInWithPopup, signOut: authMod.signOut,
    db: fsMod.getFirestore(app),
    collection: fsMod.collection, addDoc: fsMod.addDoc, doc: fsMod.doc,
    getDoc: fsMod.getDoc, getDocs: fsMod.getDocs, setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc, deleteDoc: fsMod.deleteDoc, query: fsMod.query,
    where: fsMod.where, orderBy: fsMod.orderBy, limit: fsMod.limit,
    serverTimestamp: fsMod.serverTimestamp,
  };

  initDomainStore(fb);
  configureFirebaseLoginUi();

  $("signin-google")?.addEventListener("fwClick", async () => {
    show($("signin-error"), false);
    try {
      await fb.signInWithPopup(auth, provider);
    }
    catch (err) { const e = $("signin-error"); e.textContent = err.message; show(e, true); }
  });

  authMod.onAuthStateChanged(auth, (user) => {
    if (user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`))) {
      void completeFirebaseLogin(user);
    } else {
      if (user) fb.signOut(auth);
      logout();
    }
  });

  onSessionChange(handleSession);
}

async function warnIfWorkerDown() {
  const banner = $("worker-warning");
  if (!banner) return true;
  const configUrl = `${WORKER_BASE_URL}/api/config`;
  try {
    const res = await fetch(configUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    banner.hidden = true;
    return true;
  } catch {
    banner.textContent = WORKER_DOWN_MSG;
    banner.hidden = false;
    return false;
  }
}

function agentBootLog(location, message, data, hypothesisId = "A") {
  if (typeof globalThis.location !== "undefined" &&
      globalThis.location.hostname !== "localhost" &&
      globalThis.location.hostname !== "127.0.0.1") {
    return; // Skip debug telemetry in production
  }
  const entry = { sessionId: "72b8a2", runId: "post-fix", hypothesisId, location, message, data, timestamp: Date.now() };
  // #region agent log
  try {
    const key = "se-sp-boot-debug";
    const arr = JSON.parse(sessionStorage.getItem(key) || "[]");
    arr.push(entry);
    sessionStorage.setItem(key, JSON.stringify(arr.slice(-20)));
  } catch { /* ignore */ }
  fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "72b8a2" },
    body: JSON.stringify(entry),
  }).catch(() => {});
  // #endregion
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
  assertThemeScoreSuppressionReady();
  await loadFirebaseConfig();
  agentBootLog("app.js:boot:afterLoadFirebaseConfig", "boot after loadFirebaseConfig", {
    host: typeof location !== "undefined" ? location.hostname : "",
    projectId: firebaseConfig.projectId || "",
    authMode: authMode(),
    firebaseAuthEnabled: isFirebaseAuthEnabled(),
  }, "A");

  initSidebar();
  wireUserMenu();
  initGlobalSearch({
    getSession: () => currentSession,
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
    workerDownMsg: WORKER_DOWN_MSG,
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
    switchView,
    onGenerated: async (payload, prep, meta) => {
      let lifecycleId = null;
      if (currentSession?.uid && currentSession?.teamId) {
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
      if (currentView === "dashboard") refreshDashboardFromStorage();
      if (currentView === "accounts") void renderAccountPanel();
      if (currentView === "deals") void renderDealPanel();
      if (currentView === "calls") void renderCallPanel();
      invalidateSearchIndex();
      await refreshSidebarRecentWork();
      return lifecycleId;
    },
  });
  initPostcall();
  setOnCallRecordReady((id) => openCallRecord(id));

  $("prospectEmail")?.addEventListener("fwInput", () => {
    syncAutoCompanyDomain();
    updateDomainHint();
  });
  $("prospectEmail")?.addEventListener("input", () => {
    syncAutoCompanyDomain();
    updateDomainHint();
  });
  $("companyName")?.addEventListener("fwInput", updateDomainHint);
  $("companyName")?.addEventListener("input", updateDomainHint);
  $("companyDomain")?.addEventListener("fwInput", onCompanyDomainInput);
  $("companyDomain")?.addEventListener("input", onCompanyDomainInput);

  const dashTabs = $("dash-tabs");
  if (dashTabs) {
    dashTabs.addEventListener("fwChange", (ev) => {
      const tab = ev.detail?.activeTabName || ev.detail?.tabName || ev.detail?.panel || "overview";
      switchDashboardTab(tab);
    });
  }

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("fwClick", () => switchView(btn.dataset.view));
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
    if (sessionUserId(currentSession) && currentSession?.teamId) {
      try {
        linked = await linkPostCallToLifecycle(currentSession, payload, data, record);
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
      refreshSidebarRecentWork();
    } catch (err) {
      console.warn("[app] post-call history refresh failed:", err?.message || err);
      refreshSidebarRecentWork();
    }
  });

  initDomainStore(null);

  if (authMode() === "firebase") {
    await initFirebase();
    agentBootLog("app.js:boot:afterInitFirebase", "firebase auth init complete", {
      hasSession: !!getSession(),
      googleBlockVisible: !$("firebase-signin-block")?.hidden,
      loginFormHidden: !!$("login-form")?.hidden,
    }, "B");
    if (!getSession()) showLogin();
  } else {
    initDummyAuth();
    agentBootLog("app.js:boot:dummyAuth", "dummy auth path", { handlersWired: loginHandlersWired }, "C");
    const existing = getSession();
    if (!existing) showLogin();
  }

  startWorkerHealthMonitoring();
}

void boot().catch((err) => {
  console.error("App boot failed:", err);
  agentBootLog("app.js:boot:catch", "boot failed", { error: String(err?.message || err) }, "D");
  const errEl = $("login-error");
  if (errEl) {
    errEl.textContent = `App failed to start: ${err?.message || err}. Hard-refresh (Ctrl+Shift+R) and try again.`;
    show(errEl, true);
  }
});
