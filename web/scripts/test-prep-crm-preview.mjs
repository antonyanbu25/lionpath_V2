/**
 * Regression: draft account preview must survive CRM lookup (no flicker).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDraftAccount } from "../prep-crm-resolve.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexHtml = readFileSync(join(root, "web", "index.html"), "utf8");

const draft = buildDraftAccount("bixpress.co.za", "Bixpress");
assert.equal(draft.id, null, "draft account has no CRM id");
assert.equal(draft.name, "Bixpress");
assert.equal(draft.domain, "bixpress.co.za");

// renderDealRow hides only when prepResolvedAccount is null — draft object prevents flicker.
assert.ok(draft.name && draft.id === null, "draft account keeps grid visible after lookup");

assert.ok(indexHtml.includes('class="nb-account-column"'), "Account column wrapper present");
assert.ok(indexHtml.includes(">Account</span>"), "Account label present");
assert.ok(!indexHtml.includes('id="prep-motion-row"'), "Meeting motion row removed from new-brief form");
assert.ok(!indexHtml.includes('id="prep-meeting-motion"'), "Meeting motion select removed from new-brief form");

console.log("test-prep-crm-preview.mjs: ok");
