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
} from "./auth.js";
import { initDomainStore, getStore } from "./domain/store.js";
import { seedDevDomainIfNeeded } from "./domain/seed-dev.js";
import { linkPrepToLifecycle, linkPostCallToLifecycle } from "./domain/dual-write.js";
import { renderAccountView } from "./account-view.js";
import { initGlobalSearch, invalidateSearchIndex } from "./global-search.js";
import { listPostCallAnalyses, getPostCallAnalysis, syncHistoryOnLogin, setHistoryAuthGetter, clearHistoryAuthGetter } from "./history.js";
import {
  syncTasksOnLogin,
  syncTasksAfterActivity,
  setTasksAuthGetter,
  clearTasksAuthGetter,
} from "./tasks.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { renderDashboard, renderManagerDashboard } from "./dashboard.js";
import { renderCoaching } from "./coaching.js";
import { initUserMenu, refreshUserMenu } from "./user-menu.js";
import { renderProfileSettings } from "./profile-settings.js";
import { firebaseConfig, WORKER_BASE_URL, ALLOWED_EMAIL_DOMAIN, loadFirebaseConfig, isFirebaseAuthEnabled } from "./firebase-config.js";
import {
  initPrecall,
  loadLocalBriefs,
  openPrepBrief,
  parseProspectEmails,
} from "./precall.js?v=dispute-static-v11";
import {
  displayPostCall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
} from "./postcall.js";


const PREP_RESEARCH_URL = `${WORKER_BASE_URL}/api/prep/research`;
const PREP_SYNTHESIZE_URL = `${WORKER_BASE_URL}/api/prep/synthesize`;
const DASH_TAB_STORAGE_KEY = "lionpath-dashboard-tab";
const WORKER_DOWN_MSG =
  `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
  "Start the worker: open a second terminal, run `cd worker && npm run dev` (wait for Ready on port 8787), then refresh. " +
  "Or run `npm run dev:all` from the web folder to start web + worker together. " +
  "Use the same hostname for both (localhost or 127.0.0.1 — not mixed).";

let fb = null;
let currentSession = null;
let currentView = "dashboard";
let currentDashTab = "overview";

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

const VIEW_TITLES = {
  dashboard: "My dashboard",
  precall: "Pre-call",
  postcall: "Post-call",
  accounts: "Accounts",
  manager: "Manager dashboard",
  profile: "Profile settings",
};

let selectedAccountId = null;
let accountListSearchQuery = "";
let accountDetailSearchQuery = "";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

function updateDomainHint() {
  const hint = $("domain-hint");
  if (!hint) return;
  const companyName = readFieldValue($("companyName"));
  const companyDomain = normalizeCompanyDomainField(readFieldValue($("companyDomain")));
  const emailMsg = validateProspectDomain(readFieldValue($("prospectEmail")), companyName);
  const hints = [];
  if (emailMsg) hints.push(emailMsg);
  if (companyDomain && !DOMAIN_RE.test(companyDomain)) {
    hints.push("Company domain format looks invalid (use acme.com).");
  }
  const emailDomainVal = emailDomain(readFieldValue($("prospectEmail")));
  if (companyDomain && emailDomainVal && companyDomain !== emailDomainVal) {
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
    onOpenCall: (id) => openHistoryItem(id),
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

async function renderDashboardPanels(email, opts = {}) {
  await renderDashboard($("dash-tab-overview"), email, opts);
  renderCoaching($("dash-tab-coaching"), email, {
    onOpenCall: opts.onOpenCall || ((id) => openHistoryItem(id)),
  });
}

function updateNavForRole() {
  const isManager = isManagerRole(currentSession);
  document.querySelectorAll(".nav-item[data-role]").forEach((btn) => {
    const role = btn.dataset.role;
    const showBtn = role === "manager" ? isManager : !isManager;
    btn.hidden = !showBtn;
  });
  const globalSearch = $("global-search-input");
  if (globalSearch) globalSearch.hidden = isManager;
}

function refreshActiveDashboard() {
  if (!currentSession?.email) return;
  if (isManagerRole(currentSession)) {
    if (currentView === "manager") {
      void renderManagerDashboard($("view-manager"), currentSession);
    }
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
    manager: $("view-manager"),
    profile: $("view-profile"),
  };

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
    if (name === "dashboard" || name === "coaching" || name === "precall" || name === "postcall") {
      name = "manager";
    }
  } else if (name === "manager") {
    name = "dashboard";
  }

  Object.entries(panels).forEach(([key, el]) => show(el, key === name));
  $("main-view-title").textContent = VIEW_TITLES[name] || name;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "dashboard" && !isManager) {
    const dashTab = opts.dashTab || currentDashTab || getStoredDashTab();
    switchDashboardTab(dashTab);
  } else if (name === "manager" && isManager) {
    void renderManagerDashboard($("view-manager"), currentSession);
  } else if (name === "accounts" && !isManager) {
    if (opts.accountId) selectedAccountId = opts.accountId;
    void renderAccountPanel();
  }

  const hash =
    name === "dashboard" && currentDashTab === "coaching"
      ? "dashboard/coaching"
      : name === "accounts" && selectedAccountId
        ? `accounts/${selectedAccountId}`
        : name;
  history.replaceState(null, "", `#${hash}`);
  closeSidebar();
}

async function renderAccountPanel() {
  const panel = $("account-panel");
  if (!panel || !currentSession) return;
  await renderAccountView(panel, currentSession, {
    accountId: selectedAccountId || undefined,
    listSearchQuery: accountListSearchQuery,
    detailSearchQuery: accountDetailSearchQuery,
    onListSearchQueryChange: (q) => {
      accountListSearchQuery = q;
    },
    onDetailSearchQueryChange: (q) => {
      accountDetailSearchQuery = q;
    },
    onSelectAccount: (id) => {
      selectedAccountId = id;
      switchView("accounts", { accountId: id });
    },
    onBack: () => {
      selectedAccountId = null;
      accountDetailSearchQuery = "";
      switchView("accounts");
    },
    onPrep: () => switchView("precall"),
    onPostcall: () => switchView("postcall"),
  });
}

function openHistoryItem(id) {
  const record = getPostCallAnalysis(currentSession.email, id);
  if (!record?.result) return;
  switchView("postcall");
  displayPostCall(record.result, { title: record.title });
  document.querySelectorAll(".sidebar-call-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
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
    const list = await syncHistoryOnLogin(currentSession.email);
    await syncTasksOnLogin(currentSession.email);
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

async function refreshSidebarRecentWork() {
  if (!currentSession?.email) {
    clearSidebarRecentWork();
    return;
  }

  const briefs = loadLocalBriefs().slice(0, 5);
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
          <span class="hist-meta"><span class="hist-when">${esc(b.when || "")}</span></span>
        </fw-button>
      </li>`,
        )
        .join("");
      prepList.querySelectorAll(".sidebar-prep-item").forEach((btn) => {
        btn.addEventListener("fwClick", () => openPrepBriefItem(btn.dataset.id));
      });
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
      callList.querySelectorAll(".sidebar-call-item").forEach((btn) => {
        btn.addEventListener("fwClick", () => openHistoryItem(btn.dataset.id));
      });
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
  clearHistoryAuthGetter();
  clearTasksAuthGetter();
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
    onSessionReady(currentSession, tokenFn);

    updateNavForRole();

    const defaultView = isManagerRole(enriched) ? "manager" : "dashboard";
    const hash = location.hash.replace("#", "");
    const hashAliases = {
      lifecycles: { view: "accounts" },
      coaching: { view: "dashboard", dashTab: "coaching" },
      "dashboard/coaching": { view: "dashboard", dashTab: "coaching" },
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
          switchView("accounts", { accountId: lc.accountId });
        } else {
          switchView("accounts");
        }
      } else {
        const accountMatch = /^accounts\/(.+)$/.exec(hash);
        if (accountMatch) {
          selectedAccountId = accountMatch[1];
          switchView("accounts", { accountId: selectedAccountId });
        } else {
          const valid = ["dashboard", "precall", "postcall", "accounts", "manager", "profile"];
          switchView(valid.includes(hash) ? hash : defaultView, {
            dashTab: hash === "dashboard" ? getStoredDashTab() : undefined,
          });
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
    updateDoc: fsMod.updateDoc, query: fsMod.query,
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
  if (!banner) return;
  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/config`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    banner.hidden = true;
  } catch {
    banner.textContent = WORKER_DOWN_MSG;
    banner.hidden = false;
  }
}

async function boot() {
  await loadFirebaseConfig();

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
      invalidateSearchIndex();
      await refreshSidebarRecentWork();
      return lifecycleId;
    },
  });

  $("prospectEmail")?.addEventListener("fwInput", updateDomainHint);
  $("prospectEmail")?.addEventListener("input", updateDomainHint);
  $("companyName")?.addEventListener("fwInput", updateDomainHint);
  $("companyName")?.addEventListener("input", updateDomainHint);
  $("companyDomain")?.addEventListener("fwInput", updateDomainHint);
  $("companyDomain")?.addEventListener("input", updateDomainHint);

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

  setOnAnalysisSaved(async (record, payload, data) => {
    if (currentSession?.uid && currentSession?.teamId) {
      try {
        await linkPostCallToLifecycle(currentSession, payload, data, record);
      } catch (err) {
        console.warn("Lifecycle dual-write (post-call) failed:", err);
      }
    }
    void loadPersistedHistory().then(async () => {
      if (currentSession?.email) {
        await syncTasksAfterActivity(currentSession.email, { seName: currentSession.name });
      }
      if (currentView === "dashboard" || currentView === "manager" || currentView === "accounts") {
        refreshDashboardFromStorage();
      }
      if (currentView === "accounts") void renderAccountPanel();
      invalidateSearchIndex();
      refreshSidebarRecentWork();
    });
  });

  initDomainStore(null);

  if (authMode() === "firebase") {
    await initFirebase();
    if (!getSession()) showLogin();
  } else {
    initDummyAuth();
    const existing = getSession();
    if (!existing) showLogin();
  }

  void warnIfWorkerDown();
}

void boot();
