/** Smoke test for parseProspectEmails. */

import { parseProspectEmails } from "../precall.js";

const cases = [
  ["single", "alex@acme.com", 1],
  ["comma", "alex@acme.com, sam@acme.com", 2],
  ["semicolon", "a@x.com; b@y.com", 2],
  ["dedupe", "a@x.com, a@x.com", 1],
  ["invalid skipped", "not-an-email, good@co.com", 1],
  ["empty", "", 0],
];

let failed = 0;
for (const [name, raw, expected] of cases) {
  const got = parseProspectEmails(raw);
  if (got.length !== expected) {
    console.error(`FAIL ${name}: expected ${expected}, got ${got.length}`, got);
    failed++;
  } else {
    console.log(`ok: ${name}`);
  }
}

if (failed) process.exit(1);
console.log("OK — precall input smoke test passed");
