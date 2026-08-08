/**
 * KPI count-up should not run while call-record is still hydrating (progressive mode).
 */
import { wireCallViewAnimations } from "../call-view-animate.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

globalThis.window = globalThis;
globalThis.performance = { now: () => 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.matchMedia = () => ({ matches: false });

function classList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => set.add(item)),
    remove: (...items) => items.forEach((item) => set.delete(item)),
    contains: (item) => set.has(item),
  };
}

const record = {
  classList: classList(["call-record", "call-record--progressive"]),
  dataset: { callId: "call_test" },
};

const countEl = {
  classList: classList(["call-count-up"]),
  dataset: { countTo: "4.5", countDecimals: "1" },
  textContent: "4.5",
  closest: () => record,
};

const meterEl = {
  classList: classList(["call-meter-fill"]),
  dataset: { meterTarget: "45" },
  style: { width: "0%" },
  closest: () => record,
};

const root = {
  querySelector(sel) {
    return sel === ".call-record" ? record : null;
  },
  querySelectorAll(sel) {
    if (sel.startsWith(".call-count-up") || sel === "[data-count-to]") return [countEl];
    if (sel.startsWith(".call-meter-fill") || sel === "[data-meter-target]") return [meterEl];
    return [];
  },
};

wireCallViewAnimations(root);
assert(countEl.textContent === "4.5", "progressive record should keep static KPI text");
assert(!countEl.classList.contains("call-count-up--active"), "progressive record should not start count-up");
assert(meterEl.style.width === "45%", "progressive record should paint meter target statically");
assert(record.classList.contains("call-record-anim-ready"), "progressive record should still mark anim-ready");

console.log("test-call-view-animate-progressive: ok");
