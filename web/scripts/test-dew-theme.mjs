#!/usr/bin/env node
/**
 * Smoke tests for Dew light theme wiring.
 * Run: node web/scripts/test-dew-theme.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const CRAYONS = "4.3.0-dew.14";
const pages = ["index.html", "about.html", "qc-preview.html"];

for (const page of pages) {
  const html = read(page);
  assert.match(html, new RegExp(`@freshworks/crayons@${CRAYONS.replace(/\./g, "\\.")}`), `${page} missing Crayons ${CRAYONS}`);
  assert.match(html, /dew-theme\.css/, `${page} missing dew-theme.css`);
  assert.match(html, /Figtree/, `${page} missing Figtree font`);
  assert.match(html, /theme\.js/, `${page} missing theme.js`);
}

assert.match(read("theme.js"), /return "light"/, "theme.js should default to light");
assert.doesNotMatch(read("theme.js"), /prefers-color-scheme/, "theme.js should not use OS theme default");

assert.match(read("styles.css"), /var\(--dew-primary\)/, "task pills should use Dew tokens");
assert.match(read("lifecycle.css"), /var\(--dew-border\)/, "lifecycle should use Dew border token");
assert.match(read("precall-render.js"), /dewCssVar/, "prep avatars should read Dew CSS vars");

const dewTheme = read("dew-theme.css");
assert.match(dewTheme, /--fw-spinner-color/, "spinner must use Dew tokens");
assert.match(dewTheme, /--fw-skeleton-background/, "skeleton must use Dew tokens");
assert.match(dewTheme, /--fw-label-color/, "form labels must use Dew tokens");

const index = read("index.html");
assert.match(index, /id="prep-status" class="dew-status-host"/);
assert.match(index, /id="postcall-status" class="dew-status-host"/);
assert.match(index, /id="app-loading"/);
assert.match(index, /<fw-spinner/);
assert.match(index, /<fw-skeleton/);
assert.doesNotMatch(index, /id="(?:prep|postcall)-status" class="status"/);

const crayonsUi = read("crayons-ui.js");
assert.match(crayonsUi, /export function showInlineStatus/);
assert.match(crayonsUi, /export function setButtonLoading/);
assert.match(crayonsUi, /export function setFieldError/);
assert.match(crayonsUi, /export function renderLoadingPanel/);

assert.doesNotMatch(read("precall-render.js"), /<div class="status err">/);
assert.doesNotMatch(read("postcall.js"), /<div class="status err">/);

assert.match(read("crayons-head.js"), /CRAYONS_VERSION = "4.3.0-dew.14"/);

console.log("Dew theme smoke tests passed.");
