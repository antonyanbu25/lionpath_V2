/** Regression test: KPI count-up never flashes unrelated random values. */
import assert from "node:assert/strict";
import { wireCallViewAnimations } from "../call-view-animate.js";

globalThis.window = {
  matchMedia: () => ({ matches: false }),
};
globalThis.requestAnimationFrame = () => 1;

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

const record = { classList: classList() };
const score = {
  dataset: { countTo: "8", countDecimals: "0" },
  classList: classList(),
  textContent: "8",
};
const root = {
  querySelector: (selector) => selector === ".call-record" ? record : null,
  querySelectorAll: (selector) => {
    if (selector.startsWith(".call-count-up")) return [score];
    return [];
  },
};

wireCallViewAnimations(root);
const firstFrame = Number(score.textContent);
assert(Number.isFinite(firstFrame), "count-up begins with a numeric value");
assert(firstFrame >= 0 && firstFrame <= 8, "count-up never flashes a value outside 0→target");
console.log("test-call-view-animate: ok");
