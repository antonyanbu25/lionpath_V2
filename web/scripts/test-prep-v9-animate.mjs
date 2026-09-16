/**
 * Wiring checks for v9 brief scroll animations.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const js = await readFile(join(WEB_ROOT, "precall.js"), "utf8");
const css = await readFile(join(WEB_ROOT, "precall.css"), "utf8");
const animate = await readFile(join(WEB_ROOT, "prep-v9-animate.js"), "utf8");

const checks = [
  ["animate module exports wiring fn", animate.includes("export function wirePrepV9ScrollAnimations")],
  ["precall imports animate module", js.includes('from "./prep-v9-animate.js"')],
  ["precall wires after tab render", js.includes("wirePrepV9ScrollAnimations(root)")],
  ["uses intersection observer", animate.includes("IntersectionObserver")],
  ["respects reduced motion", animate.includes("prefers-reduced-motion")],
  ["maturity chart css", css.includes('[data-prep-v9-animate="maturity-chart"]')],
  ["hero conf bar css", css.includes(".prep-v9-conf-fill")],
  ["call plan ribbon css", css.includes('[data-prep-v9-animate="call-plan"]')],
  ["disc chart css", css.includes('[data-prep-v9-animate="disc-chart"]')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}
if (failed) {
  console.error(`test-prep-v9-animate.mjs: ${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`test-prep-v9-animate.mjs: ok (${checks.length} checks)`);
