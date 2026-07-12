import { firebaseConfig, WORKER_URL, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";

const authEnabled = !!firebaseConfig.projectId;

let fb = null; // Firebase handles (populated by initFirebase when auth is enabled)
let currentUser = null;

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

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

// ---------- Rendering (matches SE_Prep_Template_GetGo.md) ----------

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

  const sub = [meta.domain, !isUnknown(meta.meetingType) ? meta.meetingType : "", !isUnknown(meta.ae) ? `AE: ${meta.ae}` : ""]
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
  const result = $("result");
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
  const status = $("status");
  const payload = {
    companyName: $("companyName").value.trim(),
    prospectEmail: $("prospectEmail").value.trim(),
    meetingType: $("meetingType").value.trim() || undefined,
    ae: $("ae").value.trim() || undefined,
  };
  const meta = {
    company: payload.companyName,
    domain: emailDomain(payload.prospectEmail),
    meetingType: payload.meetingType,
    ae: payload.ae,
  };
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Researching the prospect and drafting the brief… usually 20–40 seconds.";
  show(status, true);
  show($("result"), false);

  try {
    const headers = { "content-type": "application/json" };
    if (authEnabled && currentUser) headers["Authorization"] = `Bearer ${await currentUser.getIdToken()}`;
    const res = await fetch(WORKER_URL, { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    displayPrep(data.prep, meta);
    show(status, false);
    if (authEnabled && currentUser) await savePrep(payload, data.prep);
  } catch (err) {
    status.className = "status err";
    status.textContent = err.message || "Something went wrong.";
  } finally {
    btn.disabled = false;
  }
}

// ---------- Firestore history ----------

async function savePrep(input, prep) {
  try {
    await fb.addDoc(fb.collection(fb.db, "preps"), {
      uid: currentUser.uid,
      email: currentUser.email,
      company: input.companyName,
      prospectEmail: input.prospectEmail,
      meetingType: input.meetingType || "",
      ae: input.ae || "",
      prep,
      createdAt: fb.serverTimestamp(),
    });
    await loadHistory();
  } catch (err) {
    console.warn("Could not save to history:", err);
  }
}

async function loadHistory() {
  if (!authEnabled || !currentUser) return;
  const section = $("history-section");
  try {
    const q = fb.query(fb.collection(fb.db, "preps"), fb.where("uid", "==", currentUser.uid));
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
        displayPrep(d.prep, { company: d.company, domain: emailDomain(d.prospectEmail), meetingType: d.meetingType, ae: d.ae });
      }));
    show(section, true);
  } catch (err) {
    console.warn("Could not load history:", err);
    show(section, false);
  }
}

// ---------- Auth / boot ----------

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

  $("signin").onclick = async () => {
    show($("signin-error"), false);
    try { await fb.signInWithPopup(auth, provider); }
    catch (err) { const e = $("signin-error"); e.textContent = err.message; show(e, true); }
  };
  $("signout").onclick = () => fb.signOut(auth);

  authMod.onAuthStateChanged(auth, (user) => {
    if (user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`))) {
      currentUser = user;
      $("user-email").textContent = user.email;
      show($("userbox"), true);
      show($("signin-view"), false);
      show($("app-view"), true);
      loadHistory();
    } else {
      if (user) fb.signOut(auth);
      currentUser = null;
      show($("userbox"), false);
      show($("app-view"), false);
      show($("signin-view"), true);
    }
  });
}

function boot() {
  $("prep-form").addEventListener("submit", generate);
  if (authEnabled) {
    show($("signin-view"), true);
    initFirebase();
  } else {
    show($("app-view"), true);
  }
}
boot();
