/** Browser-free tests for session greeting picks. */

import { getSessionGreeting, resetSessionGreeting } from "../greeting.js";

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

resetSessionGreeting();
const first = getSessionGreeting();
const second = getSessionGreeting();

const checks = [
  ["greeting non-empty", Boolean(first.greeting)],
  ["subtitle non-empty", Boolean(first.subtitle)],
  ["stable within session", first.greeting === second.greeting && first.subtitle === second.subtitle],
];

resetSessionGreeting();
const third = getSessionGreeting();
checks.push(["new pick after reset", third.greeting.length > 0]);

const pools = new Set();
for (let i = 0; i < 12; i++) {
  resetSessionGreeting();
  pools.add(getSessionGreeting().greeting);
}
checks.push(["greeting variety", pools.size >= 2]);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} greeting checks passed.`);
