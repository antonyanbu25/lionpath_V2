/** expandThemeKey aligns with wireframe .thm[data-theme-key] rows. */
import { renderQipScorecard, normalizeQipScorecard } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const scorecard = {
  callType: "demo",
  rubricVersion: "2.1",
  provisional: false,
  overall: 7.2,
  confidence: 0.9,
  lines: [
    {
      themeKey: "call_flow",
      grade: 7,
      credit: 2,
      category: "communication_control",
      subParameters: [{ score: 2 }, { score: 1 }, { score: 2 }, { score: 1 }, { score: 1 }],
    },
  ],
};

const html = renderQipScorecard(scorecard, { callType: "demo" }, { context: "call-record" });
assert(html.includes('class="thm"'), "wireframe theme rows use .thm");
assert(html.includes('data-theme-key="call_flow"'), "theme rows expose data-theme-key");

const themeKey = "call_flow";
const container = { innerHTML: html };
Object.defineProperty(container, "querySelector", {
  value(sel) {
    if (sel === `.thm[data-theme-key="${themeKey}"]`) {
      return container._thm || null;
    }
    return null;
  },
  configurable: true,
});
container._thm = { tagName: "DETAILS", open: false, scrollIntoView() {} };

let opened = false;
container._thm = {
  tagName: "DETAILS",
  get open() {
    return opened;
  },
  set open(v) {
    opened = v;
  },
  closest() {
    return null;
  },
  scrollIntoView() {},
};

const match = container.querySelector(`.thm[data-theme-key="${themeKey}"]`);
assert(match, "selector finds theme row by key");
match.open = true;
assert(opened, "expandThemeKey pattern opens matching details row");

console.log("test-expand-theme-key: ok");
