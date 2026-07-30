/** Browser-free smoke test: renderSeLaunchpad populates a container. */

import { renderSeLaunchpad } from "../dashboard.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this._listeners = {};
    this.innerHTML = "";
    this.hidden = false;
  }
  querySelector(sel) {
    if (sel.startsWith("[data-action=")) {
      const action = sel.match(/data-action="([^"]+)"/)?.[1];
      return this._buttons.find((b) => b.dataset.action === action) ?? null;
    }
    if (sel === ".dash-call-link") return this._buttons.find((b) => b.classList?.contains("dash-call-link")) ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === ".dash-call-link") return this._buttons.filter((b) => b.classList?.contains("dash-call-link"));
    return [];
  }
  set innerHTML(html) {
    this._html = html;
    this._buttons = [];
    const actionRe = /data-action="([^"]+)"/g;
    let m;
    while ((m = actionRe.exec(html))) {
      const btn = new El("button");
      btn.dataset.action = m[1];
      btn.classList = { contains: (c) => c === "dash-call-link" };
      btn.addEventListener = (ev, fn) => { btn._listeners[ev] = fn; };
      this._buttons.push(btn);
    }
    const callRe = /class="[^"]*dash-call-link/g;
    while (callRe.exec(html)) {
      const btn = new El("button");
      btn.classList = { contains: (c) => c === "dash-call-link" };
      btn.dataset.callId = "test-id";
      btn.onclick = null;
      this._buttons.push(btn);
    }
  }
  get innerHTML() {
    return this._html ?? "";
  }
}

const container = new El("section");
renderSeLaunchpad(container, "se@freshworks.com", { seName: "Alex SE" });

const html = container.innerHTML;
const checks = [
  ["non-empty HTML", html.length > 200],
  ["has My dashboard title", html.includes("My dashboard")],
  ["has prep action", html.includes("Prep a call")],
  ["has analyze action", html.includes("Analyze a recording")],
  ["has follow-ups section", html.includes("Follow-ups owed")],
  ["has recent calls section", html.includes("Recent calls")],
  ["has coaching nudge", html.includes("Coaching nudge")],
  ["has empty state when no history", html.includes("No calls yet") || html.includes("All caught up")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  console.error("HTML snippet:", html.slice(0, 500));
  process.exit(1);
}
console.log("OK — launchpad render smoke test passed (" + html.length + " chars)");
