#!/usr/bin/env node
/** Fail on await inside loops in critical domain files (stage 6 guard). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const domainDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../domain");
/** Files where stage 6 eliminated fan-out — no new await-in-loop allowed. */
const ENFORCED = new Set(["org-service.js", "write-scope.js", "dual-write.js", "user-resolve.js"]);
const loopRe = /\b(for|while)\s*\(|\.forEach\s*\(/;
const awaitRe = /\bawait\b/;
const serialOkRe = /serial-ok:/;

let violations = 0;
for (const file of ENFORCED) {
  const full = path.join(domainDir, file);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, "utf8").split("\n");
  let inLoop = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (loopRe.test(line)) inLoop += 1;
    if (line.includes("}")) inLoop = Math.max(0, inLoop - (line.match(/}/g)?.length || 0));
    if (inLoop > 0 && awaitRe.test(line) && !serialOkRe.test(line)) {
      console.error(`${file}:${i + 1}: await inside loop without serial-ok`);
      violations += 1;
    }
  }
}
if (violations) process.exit(1);
console.log("test-no-await-in-loop.mjs: ok");
