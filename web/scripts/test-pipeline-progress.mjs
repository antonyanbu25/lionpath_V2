#!/usr/bin/env node
import assert from "node:assert/strict";
import { renderProgressStep, renderPipelineCard } from "../pipeline-progress.js";

// --- step icons and classes, per status ---
assert.match(renderProgressStep("Research", "done", 0), /postcall-step-done/);
assert.match(renderProgressStep("Research", "done", 0), />✓</);
assert.match(renderProgressStep("Research", "active", 1), /postcall-step-active/);
assert.match(renderProgressStep("Research", "active", 1), />…</);
assert.match(renderProgressStep("Research", "error", 2), /postcall-step-error/);
assert.match(renderProgressStep("Research", "error", 2), />!</);
assert.match(renderProgressStep("Research", "skipped", 3), /postcall-step-pending/);
assert.match(renderProgressStep("Research", "skipped", 3), />–</);

// Pending shows its 1-based position.
assert.match(renderProgressStep("Research", "pending", 4), /postcall-step-pending/);
assert.match(renderProgressStep("Research", "pending", 4), />5</);

// Labels are escaped — a step label can carry a company name.
assert.match(renderProgressStep('A & <b>B</b>', "pending", 0), /A &amp; &lt;b&gt;B&lt;\/b&gt;/);
assert.doesNotMatch(renderProgressStep('<img src=x>', "pending", 0), /<img/);

// --- progress bar percentage ---
const steps = (statuses) => statuses.map((status, i) => ({ label: `s${i}`, status }));

const none = renderPipelineCard(steps(["pending", "pending", "pending", "pending"]));
assert.match(none, /aria-valuenow="0"/);
assert.match(none, /0 of 4 complete/);

const half = renderPipelineCard(steps(["done", "done", "active", "pending"]));
assert.match(half, /aria-valuenow="50"/);
assert.match(half, /2 of 4 complete/);

const all = renderPipelineCard(steps(["done", "done", "done", "done"]));
assert.match(all, /aria-valuenow="100"/);

// Skipped counts as resolved, so the bar cannot stall on an optional stage.
const skipped = renderPipelineCard(steps(["done", "skipped", "active", "pending"]));
assert.match(skipped, /aria-valuenow="50"/, "skipped counts toward progress");

// Empty list must not divide by zero.
assert.match(renderPipelineCard([]), /aria-valuenow="0"/);

// --- accessibility + structure ---
assert.match(half, /role="progressbar"/);
assert.match(half, /aria-valuemin="0"/);
assert.match(half, /aria-valuemax="100"/);
assert.match(half, /<ol class="postcall-step-list">/);
assert.equal((half.match(/<li class="postcall-step/g) || []).length, 4, "one li per step");

// --- title and custom meta ---
assert.match(renderPipelineCard(steps(["done"]), { title: "Brief pipeline" }), /Brief pipeline/);
const withMeta = renderPipelineCard(steps(["done", "active"]), { meta: "12 facts · 5 sources" });
assert.match(withMeta, /12 facts · 5 sources/);
assert.doesNotMatch(withMeta, /1 of 2 complete/, "custom meta replaces the default counter");
// An explicit empty meta is honoured rather than falling back to the counter.
assert.doesNotMatch(renderPipelineCard(steps(["done"]), { meta: "" }), /1 of 1 complete/);

console.log("test-pipeline-progress.mjs: ok");
