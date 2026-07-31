#!/usr/bin/env node
/**
 * Mirror-drift guard: runs the SAME fixture as
 * worker/scripts/test-context-attachments.ts against the web implementation.
 * If web/prep-context-attachments.js drifts from worker/src/prep/context-attachments.ts,
 * the research cache key computed in the browser stops matching the worker's — and
 * one of these two suites fails first.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MAX_CONTEXT_ATTACHMENTS,
  MAX_CONTEXT_ATTACHMENT_CHARS,
  MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS,
  contextAttachmentsFingerprint,
  mergeContextAttachments,
  normalizeContextAttachments,
} from "../prep-context-attachments.js";
import { computePrepInputHash } from "../prep-input-hash.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(join(here, "../../worker/testdata/context-attachments/cases.json"), "utf8"),
);

/** JSON cannot hold a 25k-char literal — `pad: N` means text = "x".repeat(N). */
function expand(item) {
  if (typeof item.pad === "number") return { fileName: item.fileName, text: "x".repeat(item.pad) };
  return item;
}

let checks = 0;

for (const c of cases.normalize) {
  const out = normalizeContextAttachments(c.in.map(expand));
  if (c.expectNames) {
    assert.deepEqual(out.map((a) => a.fileName), c.expectNames, c.name);
    checks++;
  }
  if (c.expect) {
    assert.equal(out.length, c.expect.length, `${c.name}: count`);
    c.expect.forEach((want, i) => {
      assert.equal(out[i].fileName, want.fileName, `${c.name}: fileName[${i}]`);
      if (want.text !== undefined) assert.equal(out[i].text, want.text, `${c.name}: text[${i}]`);
      if (want.len !== undefined) assert.equal(out[i].text.length, want.len, `${c.name}: len[${i}]`);
      if (want.truncated !== undefined) {
        assert.equal(!!out[i].truncated, want.truncated, `${c.name}: truncated[${i}]`);
      }
    });
    checks++;
  }
}

for (const c of cases.merge) {
  assert.equal(mergeContextAttachments(c.context, c.attachments), c.expect, c.name);
  checks++;
}

for (const c of cases.fingerprint) {
  const same = contextAttachmentsFingerprint(c.a) === contextAttachmentsFingerprint(c.b);
  assert.equal(same, c.same, c.name);
  checks++;
}

// --- nullish / hostile input ---
for (const bad of [undefined, null, "nope", 7, {}, [null], [undefined], [{}], [{ text: null }]]) {
  assert.deepEqual(normalizeContextAttachments(bad), [], `nullish ${JSON.stringify(bad)}`);
  checks++;
}
assert.equal(mergeContextAttachments(undefined, undefined), "", "undefined/undefined merges to empty");
assert.equal(mergeContextAttachments("typed", null), "typed", "null attachments preserve typed text");
checks += 2;

// --- caps ---
{
  const many = Array.from({ length: 20 }, (_, i) => ({
    fileName: `f${i}.txt`,
    text: "y".repeat(MAX_CONTEXT_ATTACHMENT_CHARS),
  }));
  const out = normalizeContextAttachments(many);
  assert.ok(out.length <= MAX_CONTEXT_ATTACHMENTS, "file count capped");
  const total = out.reduce((n, a) => n + a.text.length, 0);
  assert.ok(total <= MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS, `total ${total} exceeds cap`);
  checks += 2;
}

// --- idempotence, including the truncated flag ---
{
  const shape = (list) =>
    list.map((a) => ({ fileName: a.fileName, len: a.text.length, truncated: !!a.truncated }));
  const once = normalizeContextAttachments([
    { fileName: "a.txt", text: "Channel mix is email and chat." },
    { fileName: "b.xlsx", text: "x".repeat(30_000) },
  ]);
  const twice = normalizeContextAttachments(once);
  assert.deepEqual(shape(twice), shape(once), "normalize is idempotent");
  assert.equal(once[1].truncated, true, "the truncated flag survives a second pass");
  checks += 2;
}

// --- CACHE-KEY CONTRACT (browser side) ---
// computePrepInputHash must stay byte-identical when nothing is attached, and must
// agree with the worker when something is. The worker suite asserts the same identity
// from its side; together they pin the two hashes to one value.
{
  const args = ["Acme", "acme.com", ["sam@acme.com"], ""];
  const ctx = "AE says renewal is Q3.";

  const noAtt = computePrepInputHash(...args, { additionalContext: ctx });
  assert.equal(
    computePrepInputHash(...args, {
      additionalContext: mergeContextAttachments(ctx, []),
    }),
    noAtt,
    "no attachments leaves the hash unchanged",
  );
  assert.equal(
    computePrepInputHash(...args, {
      additionalContext: mergeContextAttachments(ctx, [{ fileName: "junk.pdf", text: "x" }]),
    }),
    noAtt,
    "an unusable attachment leaves the hash unchanged",
  );
  assert.notEqual(
    computePrepInputHash(...args, {
      additionalContext: mergeContextAttachments(ctx, [
        { fileName: "a.txt", text: "Channel mix is email and chat." },
      ]),
    }),
    noAtt,
    "a real attachment changes the hash",
  );
  checks += 3;
}

console.log(`test-prep-context-attachments.mjs: ok (${checks} checks shared with worker)`);
