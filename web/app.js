import { readFieldValue, readFieldValueAsync } from "./crayons-ui.js";
import { initSidebar } from "./sidebar.js";
import { initFeedback } from "./feedback.js";
import {
  authMode,
  getSession,
  loginDummy,
  logout,
  onSessionChange,
  persistFirebaseSession,
  isManagerRole,
} from "./auth.js";
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
import { firebaseConfig, WORKER_BASE_URL, ALLOWED_EMAIL_DOMAIN, loadFirebaseConfig } from "./firebase-config.js";
import {
  initPrecall,
  loadLocalBriefs,
  openPrepBrief,
  parseProspectEmails,
} from "./precall.js";
import {
  displayPostCall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
} from "./postcall.js";

function isAuthEnabled() {
  return authMode() === "firebase";
}

const PREP_URL = `${WORKER_BASE_URL}/api/generate-prep`;
const DASH_TAB_STORAGE_KEY = "lionpath-dashboard-tab";
const WORKER_DOWN_MSG =
  `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
  "Start the worker in another terminal: cd worker → npm.cmd run dev (look for Ready on port 8787). " +
  "Use the same hostname for web and worker (both localhost or both 127.0.0.1), then refresh.";

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
  manager: "Manager dashboard",
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const emailDomain = (email) => {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
};

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
  const msg = validateProspectDomain(readFieldValue($("prospectEmail")), readFieldValue($("companyName")));
  if (msg) {
    hint.textContent = msg;
    hint.className = "field-hint warn";
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
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
  if (!isAuthEnabled() || !fb?.auth?.currentUser || !fb?.db) return undefined;
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
}

function refreshActiveDashboard() {
  if (!currentSession?.email) return;
  if (isManagerRole(currentSession)) {
    if (currentView === "manager") {
      renderManagerDashboard($("view-manager"));
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
    manager: $("view-manager"),
  };

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
    renderManagerDashboard($("view-manager"));
  }

  const hash =
    name === "dashboard" && currentDashTab === "coaching"
      ? "dashboard/coaching"
      : name;
  history.replaceState(null, "", `#${hash}`);
  closeSidebar();
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

function refreshSidebarRecentWork() {
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

function updateSidebarUser() {
  const name = currentSession?.name || "";
  $("sidebar-user-name").textContent = name;
  $("sidebar-user-role").textContent =
    isManagerRole(currentSession) ? "Manager" : "Solution Engineer";
  const avatar = $("sidebar-user-avatar");
  if (avatar) {
    avatar.textContent = name ? name.charAt(0).toUpperCase() : "🦁";
    avatar.title = name;
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

function setAuthLoading(loading) {
  const el = $("auth-loading");
  if (el) {
    el.hidden = !loading;
    el.setAttribute("aria-busy", loading ? "true" : "false");
  }
}

function showDummyLoginUI() {
  setAuthLoading(false);
  show($("login-form"), true);
  const hint = document.querySelector(".login-hint");
  if (hint) hint.hidden = false;
  show($("firebase-signin-block"), false);
}

function showFirebaseLoginUI() {
  setAuthLoading(false);
  show($("login-form"), false);
  const hint = document.querySelector(".login-hint");
  if (hint) hint.hidden = true;
  const block = $("firebase-signin-block");
  show(block, true);
  const divider = block?.querySelector(".or-divider");
  if (divider) divider.hidden = true;
}

function showLogin() {
  show($("login-view"), true);
  show($("app-shell"), false);
  currentSession = null;
  clearHistoryAuthGetter();
  clearTasksAuthGetter();
  clearSidebarHistory();
  onSessionCleared();
  if (authMode() === "firebase") showFirebaseLoginUI();
  else showDummyLoginUI();
}

async function showApp(session, opts = {}) {
  currentSession = session?.email
    ? { ...session, email: String(session.email).trim().toLowerCase() }
    : session;
  show($("login-view"), false);
  show($("app-shell"), true);
  updateSidebarUser();

  const tokenFn = isAuthEnabled() && fb?.auth?.currentUser
    ? () => fb.auth.currentUser.getIdToken()
    : null;
  setHistoryAuthGetter(tokenFn);
  setTasksAuthGetter(tokenFn);
  onSessionReady(currentSession, tokenFn);

  updateNavForRole();

  const defaultView = isManagerRole(session) ? "manager" : "dashboard";
  const hash = location.hash.replace("#", "");
  const hashAliases = {
    coaching: { view: "dashboard", dashTab: "coaching" },
    "dashboard/coaching": { view: "dashboard", dashTab: "coaching" },
    analysis: { view: "postcall" },
    workspace: { view: "postcall" },
  };
  const alias = hashAliases[hash];
  if (alias) {
    switchView(alias.view, { dashTab: alias.dashTab });
  } else {
    const valid = ["dashboard", "precall", "postcall", "manager"];
    switchView(valid.includes(hash) ? hash : defaultView, {
      dashTab: hash === "dashboard" ? getStoredDashTab() : undefined,
    });
  }
  void loadPersistedHistory();
}

function handleSession(session, opts = {}) {
  if (session) void showApp(session, opts);
  else showLogin();
}

// ---------- Dummy login ----------

let loginInFlight = false;

async function submitLogin(e) {
  if (loginInFlight) return;
  loginInFlight = true;
  try {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const errEl = $("login-error");
    show(errEl, false);

    const email = await readFieldValueAsync($("login-email"));
    const password = await readFieldValueAsync($("login-password"));

    if (!email || !password) {
      errEl.textContent = "Enter email and password.";
      show(errEl, true);
      return;
    }

    const result = loginDummy(email, password);
    if (!result.ok) {
      errEl.textContent = result.error;
      show(errEl, true);
      return;
    }
    handleSession(result.session, { freshLogin: true });
  } finally {
    loginInFlight = false;
  }
}

function wireLoginHandlers() {
  $("login-form")?.addEventListener("submit", (e) => {
    void submitLogin(e);
  });
  $("login-submit")?.addEventListener("fwClick", (e) => {
    void submitLogin(e);
  });
  $("login-submit")?.addEventListener("click", (e) => {
    void submitLogin(e);
  });
  $("login-password")?.addEventListener("fwInputEnter", () => {
    void submitLogin();
  });
}

function initDummyAuth() {
  if (customElements.get("fw-button")) {
    wireLoginHandlers();
  } else {
    customElements.whenDefined("fw-button").then(wireLoginHandlers);
  }

  $("logout-btn")?.addEventListener("fwClick", () => logout());

  const existing = getSession();
  if (existing) handleSession(existing);

  onSessionChange(handleSession);
}

// ---------- Firebase auth (optional) ----------

async function bootstrapUserDoc(user) {
  if (!fb?.db || !user?.uid) return;
  try {
    const email = String(user.email || "").trim().toLowerCase();
    const role = email.startsWith("manager@") ? "manager" : "se";
    await fb.setDoc(
      fb.doc(fb.db, "users", user.uid),
      {
        email,
        name: user.displayName || email.split("@")[0],
        role,
        lastLoginAt: fb.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn("[auth] could not bootstrap users doc:", err);
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
    collection: fsMod.collection, addDoc: fsMod.addDoc, doc: fsMod.doc, setDoc: fsMod.setDoc,
    query: fsMod.query, where: fsMod.where, getDocs: fsMod.getDocs, serverTimestamp: fsMod.serverTimestamp,
  };

  const signIn = async () => {
    show($("signin-error"), false);
    try {
      await fb.signInWithPopup(auth, provider);
    } catch (err) {
      const e = $("signin-error");
      e.textContent = err.message;
      show(e, true);
    }
  };

  $("signin-google")?.addEventListener("fwClick", () => { void signIn(); });

  $("logout-btn")?.addEventListener("fwClick", async () => {
    await fb.signOut(auth);
    logout();
  });

  authMod.onAuthStateChanged(auth, (user) => {
    if (user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`))) {
      persistFirebaseSession(user);
      void bootstrapUserDoc(user);
      handleSession(getSession());
    } else {
      if (user) fb.signOut(auth);
      logout();
    }
  });

  const existing = getSession();
  if (existing) {
    setAuthLoading(false);
    handleSession(existing);
  } else {
    showLogin();
  }
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

function boot() {
  initSidebar();
  initFeedback({
    workerUrl: WORKER_BASE_URL,
    getEmail: () => currentSession?.email || "",
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
  });
  initPrecall({
    prepUrl: PREP_URL,
    authEnabled: isAuthEnabled(),
    workerDownMsg: WORKER_DOWN_MSG,
    getToken: async () => fb?.auth?.currentUser?.getIdToken(),
    switchView,
    onGenerated: async (payload, prep, meta) => {
      if (currentSession?.email) {
        void syncTasksAfterActivity(currentSession.email, {
          seName: currentSession.name,
          prepResult: prep,
          company: payload.companyName,
        }).then(() => {
          if (currentView === "dashboard") refreshDashboardFromStorage();
        });
      }
      if (isAuthEnabled() && fb?.auth?.currentUser) await savePrep(payload, prep, meta);
      if (currentView === "dashboard") refreshDashboardFromStorage();
      refreshSidebarRecentWork();
    },
  });

  $("prospectEmail")?.addEventListener("fwInput", updateDomainHint);
  $("prospectEmail")?.addEventListener("input", updateDomainHint);
  $("companyName")?.addEventListener("fwInput", updateDomainHint);
  $("companyName")?.addEventListener("input", updateDomainHint);

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

  setOnAnalysisSaved(() => {
    void loadPersistedHistory().then(async () => {
      if (currentSession?.email) {
        await syncTasksAfterActivity(currentSession.email, { seName: currentSession.name });
      }
      if (currentView === "dashboard" || currentView === "manager") {
        refreshDashboardFromStorage();
      }
    });
  });

  if (authMode() === "firebase") {
    void initFirebase();
  } else {
    initDummyAuth();
    if (getSession()) setAuthLoading(false);
    else showLogin();
  }

  void warnIfWorkerDown();
}

loadFirebaseConfig().then(() => boot());
