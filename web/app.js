import { firebaseConfig, WORKER_BASE_URL, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";
import {
  authMode,
  getSession,
  loginDummy,
  logout,
  onSessionChange,
  persistFirebaseSession,
} from "./auth.js";
import { listPostCallAnalyses, getPostCallAnalysis, syncHistoryOnLogin, setHistoryAuthGetter, clearHistoryAuthGetter } from "./history.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { renderDashboard } from "./dashboard.js";
import {
  displayPostCall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
} from "./postcall.js";

const authEnabled = !!firebaseConfig.projectId;
const PREP_URL = `${WORKER_BASE_URL}/api/generate-prep`;
const WORKER_DOWN_MSG =
  `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
  "Start the worker in another terminal: cd worker → npm.cmd run dev (look for Ready on port 8787). " +
  "Use the same hostname for web and worker (both localhost or both 127.0.0.1), then refresh.";

let fb = null;
let currentSession = null;
let currentView = "dashboard";

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

const VIEW_TITLES = {
  dashboard: "My dashboard",
  analysis: "New analysis",
  precall: "Pre-call prep",
  manager: "Manager view",
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const isUnknown = (v) => !v || String(v).trim().toLowerCase() === "unknown";
const emailDomain = (email) => {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
};
const joinDot = (arr) => (arr || []).filter((x) => !isUnknown(x)).map(esc).join(" · ");
const cell = (v) => (isUnknown(v) ? '<span class="muted">unknown</span>' : esc(v));

// ---------- Views ----------

function switchView(name) {
  currentView = name;
  const isManager = currentSession?.role === "manager";
  const panels = {
    dashboard: $("view-dashboard"),
    analysis: $("view-analysis"),
    precall: $("view-precall"),
    manager: $("view-manager"),
  };

  if (isManager && name === "dashboard") {
    name = "manager";
  }

  Object.entries(panels).forEach(([key, el]) => show(el, key === name));
  $("main-view-title").textContent = VIEW_TITLES[name] || name;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name || (name === "manager" && btn.dataset.view === "dashboard"));
  });

  if (name === "dashboard" && !isManager) {
    renderDashboard($("view-dashboard"), currentSession.email, {
      onOpenCall: (id) => openHistoryItem(id),
    });
  }

  history.replaceState(null, "", `#${name}`);
  closeSidebar();
}

function openHistoryItem(id) {
  const record = getPostCallAnalysis(currentSession.email, id);
  if (!record?.result) return;
  switchView("analysis");
  displayPostCall(record.result, { title: record.title });
  document.querySelectorAll(".sidebar-history-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function clearSidebarHistory() {
  const ul = $("sidebar-history-list");
  const empty = $("sidebar-history-empty");
  if (ul) ul.innerHTML = "";
  if (empty) show(empty, true);
}

function refreshDashboardFromStorage() {
  if (!currentSession?.email || currentSession.role === "manager") return;
  renderDashboard($("view-dashboard"), currentSession.email, {
    onOpenCall: (id) => openHistoryItem(id),
  });
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

function refreshSidebarHistory() {
  if (!currentSession?.email) {
    clearSidebarHistory();
    return;
  }
  const list = listPostCallAnalyses(currentSession.email);
  const ul = $("sidebar-history-list");
  const empty = $("sidebar-history-empty");

  if (!list.length) {
    ul.innerHTML = "";
    show(empty, true);
    return;
  }

  show(empty, false);
  ul.innerHTML = list
    .slice(0, 20)
    .map((r) => {
      const when = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "";
      const qc = r.analysis?.qualityCoach;
      const score = qc ? normalizeQualityCoach(qc).overallScore : null;
      const scoreBadge = score != null ? `<span class="hist-score">${score}/10</span>` : "";
      return `<li>
        <button type="button" class="sidebar-history-item" data-id="${esc(r.id)}" title="${esc(r.title)}">
          <span class="hist-title">${esc(r.title)}</span>
          <span class="hist-meta">${scoreBadge}<span class="hist-when">${esc(when)}</span></span>
        </button>
      </li>`;
    })
    .join("");

  ul.querySelectorAll(".sidebar-history-item").forEach((btn) => {
    btn.onclick = () => openHistoryItem(btn.dataset.id);
  });
}

function updateSidebarUser() {
  $("sidebar-user-name").textContent = currentSession?.name || "";
  $("sidebar-user-role").textContent =
    currentSession?.role === "manager" ? "Manager" : "Solution Engineer";
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

// ---------- Rendering (pre-call) ----------

function renderPrep(p, meta = {}) {
  const rs = p.researchSnapshot || {};
  const ts = rs.techStack || {};
  const dp = p.demoPlan || {};

  const attendees = (rs.attendees || []).length
    ? (rs.attendees || [])
        .map((a) => `${esc(a.name)}${a.email && !isUnknown(a.email) ? ` (${esc(a.email)})` : ""}${a.note && !isUnknown(a.note) ? ` — ${esc(a.note)}` : ""}`)
        .join("<br>")
    : '<span class="muted">unknown</span>';

  const gaps = (rs.discoveryGaps || []).length
    ? (rs.discoveryGaps || [])
        .map((g) => `<strong>${esc(g.label)}:</strong> ${esc(g.question)}`)
        .join("<br><br>")
    : '<span class="muted">none</span>';

  const snapshot = `
    <h2>Research Snapshot</h2>
    <table class="snap">
      <tr><th>Attendee</th><td>${attendees}</td></tr>
      <tr><th>What they do</th><td>${cell(rs.whatTheyDo)}</td></tr>
      <tr><th>Size</th><td>${cell(rs.size)}</td></tr>
      <tr><th>Support channels</th><td>${cell(rs.supportChannels)}</td></tr>
      <tr><th>Tech stack</th><td>${cell(ts.summary)}</td></tr>
      <tr><th>Pain points</th><td>${joinDot(rs.painPoints) || '<span class="muted">unknown</span>'}</td></tr>
      <tr><th>Goals</th><td>${joinDot(rs.goals) || '<span class="muted">unknown</span>'}</td></tr>
      <tr><th>Discovery gaps</th><td>${gaps}</td></tr>
    </table>`;

  const useCases = (dp.useCases || []).length
    ? `<table><tr><th class="num">#</th><th>Use case</th><th>Why</th></tr>${(dp.useCases || [])
        .map((u) => `<tr><td class="num">${esc(u.rank)}</td><td>${esc(u.useCase)}</td><td>${esc(u.why)}</td></tr>`)
        .join("")}</table>`
    : '<p class="muted">No use cases returned.</p>';

  const diffs = (dp.differentiators || []).length
    ? `<table><tr><th>vs.</th><th>Key points</th></tr>${(dp.differentiators || [])
        .map((d) => `<tr><td>${esc(d.vendor)}</td><td><ul>${(d.points || []).map((pt) => `<li>${esc(pt)}</li>`).join("")}</ul></td></tr>`)
        .join("")}</table>`
    : '<p class="muted">No incumbent tool identified — position on unified platform + Freddy AI, not against a named competitor.</p>';

  const demo = `
    <h2>Demo Plan</h2>
    <p><strong>Flow:</strong> ${cell(dp.flow)}</p>
    <h3>Use cases <span class="opt">(SE picks the Freshworks feature for each)</span></h3>
    ${useCases}
    ${dp.close && !isUnknown(dp.close) ? `<h3>Close</h3><p>${esc(dp.close)}</p>` : ""}
    <h3>Differentiator <span class="opt">(only vs. vendors named in the stack)</span></h3>
    ${diffs}`;

  const sources = (p.sources || []).length
    ? `<details class="sources"><summary>Sources (${p.sources.length})</summary><ul>${(p.sources || [])
        .map((s) => `<li>${esc(s.claim)} — ${s.url && !isUnknown(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : '<span class="muted">no link</span>'}</li>`)
        .join("")}</ul></details>`
    : "";

  const sub = [meta.domain, meta.additionalContext ? "context provided" : ""]
    .filter(Boolean).map(esc).join(" · ");

  return `
    <div class="toolbar">
      <button class="ghost" onclick="window.print()">Print / PDF</button>
      <button class="ghost" id="copy-json">Copy JSON</button>
    </div>
    <div class="head"><h2 style="border:none">${esc(meta.company || "")}</h2><span class="sub">${sub}</span></div>
    <section>${snapshot}</section>
    <section>${demo}</section>
    ${sources}`;
}

function displayPrep(prep, meta) {
  const result = $("prep-result");
  result.innerHTML = renderPrep(prep, meta || {});
  show(result, true);
  const copyBtn = $("copy-json");
  if (copyBtn) copyBtn.onclick = () => navigator.clipboard.writeText(JSON.stringify(prep, null, 2));
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Generate ----------

async function generate(e) {
  e.preventDefault();
  const btn = $("generate");
  const status = $("prep-status");
  const payload = {
    companyName: $("companyName").value.trim(),
    prospectEmail: $("prospectEmail").value.trim(),
    additionalContext: $("additionalContext").value.trim() || undefined,
  };
  const meta = {
    company: payload.companyName,
    domain: emailDomain(payload.prospectEmail),
    additionalContext: payload.additionalContext,
  };
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Researching the prospect and drafting the brief… usually 15–45 seconds. Please wait.";
  show(status, true);
  show($("prep-result"), false);
  const form = $("prep-form");
  form?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = true; });

  try {
    const headers = { "content-type": "application/json" };
    if (authEnabled && fb?.auth?.currentUser) {
      headers["Authorization"] = `Bearer ${await fb.auth.currentUser.getIdToken()}`;
    }
    const res = await fetch(PREP_URL, { method: "POST", headers, body: JSON.stringify(payload) });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    displayPrep(data.prep, meta);
    show(status, false);
    if (authEnabled && fb?.auth?.currentUser) await savePrep(payload, data.prep);
  } catch (err) {
    status.className = "status err";
    const msg = err.message || "Something went wrong.";
    status.textContent =
      msg === "Failed to fetch" || /network|fetch/i.test(msg) ? WORKER_DOWN_MSG : msg;
  } finally {
    btn.disabled = false;
    $("prep-form")?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = false; });
  }
}

// ---------- Firestore prep history (when Firebase enabled) ----------

async function savePrep(input, prep) {
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
    await loadPrepHistory();
  } catch (err) {
    console.warn("Could not save to history:", err);
  }
}

async function loadPrepHistory() {
  if (!authEnabled || !fb?.auth?.currentUser) return;
  const section = $("history-section");
  try {
    const user = fb.auth.currentUser;
    const q = fb.query(fb.collection(fb.db, "preps"), fb.where("uid", "==", user.uid));
    const snap = await fb.getDocs(q);
    const docs = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 10);
    if (!docs.length) { show(section, false); return; }
    $("history").innerHTML = docs
      .map((d, i) => {
        const when = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000).toLocaleString() : "";
        return `<li><span><strong>${esc(d.company)}</strong> · ${esc(d.prospectEmail)}</span>
          <span><button class="link-btn" data-i="${i}">view</button> <span class="when">${esc(when)}</span></span></li>`;
      })
      .join("");
    $("history").querySelectorAll("button[data-i]").forEach((b) =>
      (b.onclick = () => {
        const d = docs[Number(b.dataset.i)];
        displayPrep(d.prep, { company: d.company, domain: emailDomain(d.prospectEmail), additionalContext: d.additionalContext });
      }));
    show(section, true);
  } catch (err) {
    console.warn("Could not load history:", err);
    show(section, false);
  }
}

// ---------- Auth UI ----------

function showLogin() {
  show($("login-view"), true);
  show($("app-shell"), false);
  currentSession = null;
  clearHistoryAuthGetter();
  clearSidebarHistory();
  onSessionCleared();
}

async function showApp(session) {
  currentSession = session?.email
    ? { ...session, email: String(session.email).trim().toLowerCase() }
    : session;
  show($("login-view"), false);
  show($("app-shell"), true);
  updateSidebarUser();

  const tokenFn = authEnabled && fb?.auth?.currentUser
    ? () => fb.auth.currentUser.getIdToken()
    : null;
  setHistoryAuthGetter(tokenFn);
  onSessionReady(currentSession, tokenFn);

  await loadPersistedHistory();

  const defaultView = session.role === "manager" ? "manager" : "dashboard";
  const hash = location.hash.replace("#", "");
  const valid = ["dashboard", "analysis", "precall", "manager"];
  switchView(valid.includes(hash) ? hash : defaultView);
  if (authEnabled) loadPrepHistory();
}

function handleSession(session) {
  if (session) void showApp(session);
  else showLogin();
}

// ---------- Dummy login ----------

function initDummyAuth() {
  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = $("login-error");
    show(errEl, false);
    const result = loginDummy($("login-email").value, $("login-password").value);
    if (!result.ok) {
      errEl.textContent = result.error;
      show(errEl, true);
      return;
    }
    handleSession(result.session);
  });

  $("logout-btn").onclick = () => logout();

  const existing = getSession();
  if (existing) handleSession(existing);

  onSessionChange(handleSession);
}

// ---------- Firebase auth (optional) ----------

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
    collection: fsMod.collection, addDoc: fsMod.addDoc, query: fsMod.query,
    where: fsMod.where, getDocs: fsMod.getDocs, serverTimestamp: fsMod.serverTimestamp,
  };

  show($("firebase-signin-block"), true);

  $("signin-google").onclick = async () => {
    show($("signin-error"), false);
    try { await fb.signInWithPopup(auth, provider); }
    catch (err) { const e = $("signin-error"); e.textContent = err.message; show(e, true); }
  };

  $("logout-btn").onclick = async () => {
    await fb.signOut(auth);
    logout();
  };

  authMod.onAuthStateChanged(auth, (user) => {
    if (user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`))) {
      persistFirebaseSession(user);
      handleSession(getSession());
    } else {
      if (user) fb.signOut(auth);
      logout();
    }
  });

  const existing = getSession();
  if (existing) handleSession(existing);
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
  $("prep-form").addEventListener("submit", generate);

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.view === "analysis") {
        show($("postcall-result"), false);
        show($("postcall-status"), false);
      }
      switchView(btn.dataset.view);
    };
  });

  $("sidebar-toggle").onclick = openSidebar;
  $("sidebar-close").onclick = closeSidebar;
  $("sidebar-backdrop").onclick = closeSidebar;

  setOnAnalysisSaved(() => {
    void loadPersistedHistory().then(() => {
      if (currentView === "dashboard") refreshDashboardFromStorage();
    });
  });

  if (authMode() === "firebase") {
    initFirebase();
  } else {
    initDummyAuth();
    const existing = getSession();
    if (!existing) showLogin();
  }

  void warnIfWorkerDown();
}

boot();
