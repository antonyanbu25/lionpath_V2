#!/usr/bin/env node
/**
 * Firestore rules structural smoke — validates rule helpers and collection blocks.
 * Does NOT run the Firebase emulator (TEST-004 gap documented below).
 *
 * Run: node web/scripts/test-firestore-rules-smoke.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const rulesPath = join(root, "firestore.rules");
const rules = readFileSync(rulesPath, "utf8");

const EMULATOR_GAP =
  "Firebase rules emulator not run in CI — deny/allow matrix requires manual emulator session before prod deploy.";

const results = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
    results.push(true);
  } catch (err) {
    console.error(`  FAIL: ${name}`, err?.message || err);
    results.push(false);
  }
}

check("rules file parses as non-empty string", () => {
  assert.ok(rules.length > 500, "firestore.rules should be substantial");
  assert.match(rules, /rules_version\s*=\s*'2'/);
});

check("account read/write helpers present", () => {
  assert.match(rules, /function canReadAccountData/);
  assert.match(rules, /function canCreateAccount/);
  assert.match(rules, /match \/accounts\//);
});

check("deal read/write parity — canWriteDealResource on deals update", () => {
  assert.match(rules, /function canWriteDealResource/);
  assert.match(rules, /function canReadDealResource/);
  const dealsBlock = rules.match(/match \/deals\/\{dealId\}[\s\S]*?match \/lifecycles\//);
  assert.ok(dealsBlock, "deals block must exist");
  assert.match(dealsBlock[0], /allow update: if canWriteDealResource\(resource\.data\)/);
});

check("dealContacts join collection guarded", () => {
  assert.match(rules, /match \/dealContacts\//);
  assert.match(rules, /canWriteDealResource\(\s*get\(\/databases\/\$\(database\)\/documents\/deals/);
});

check("account create requires org membership (ACC-010 tightening)", () => {
  const accountsBlock = rules.match(/match \/accounts\/\{accountId\}[\s\S]*?match \/contacts\//);
  assert.ok(accountsBlock, "accounts block must exist");
  assert.match(accountsBlock[0], /allow create: if canCreateAccount\(\)/);
  assert.doesNotMatch(accountsBlock[0], /allow create: if isSignedIn\(\);/);
});

check("contact rules inherit account scope", () => {
  assert.match(rules, /match \/contacts\/\{contactId\}/);
  assert.match(rules, /canReadAccountData\(\s*get\(\/databases\/\$\(database\)\/documents\/accounts\/\$\(resource\.data\.accountId\)\)/);
});

console.log("\n--- Emulator gap (TEST-004) ---");
console.log(EMULATOR_GAP);

const failed = results.filter((r) => !r).length;
if (failed) {
  console.error(`\ntest-firestore-rules-smoke.mjs: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`\ntest-firestore-rules-smoke.mjs: ${results.length}/${results.length} PASS`);
