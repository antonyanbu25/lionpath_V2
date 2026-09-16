/**
 * SE-attached context files: normalize / merge / fingerprint. Pure, no network.
 * Runs the SAME fixture as web/scripts/test-prep-context-attachments.mjs, so a
 * drift between the worker module and its web mirror fails one of the two suites.
 *
 * Usage: tsx worker/scripts/test-context-attachments.ts
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
} from "../src/prep/context-attachments.ts";
import { buildInputHashPayload, computeInputHash } from "../src/prep/input-hash.ts";
import type { PrepInput } from "../src/prep/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(join(here, "../testdata/context-attachments/cases.json"), "utf8"),
) as {
  normalize: Array<{
    name: string;
    in: Array<{ fileName?: string; text?: string; pad?: number }>;
    expect?: Array<{ fileName: string; text?: string; len?: number; truncated?: boolean }>;
    expectNames?: string[];
  }>;
  merge: Array<{ name: string; context: string; attachments: unknown[]; expect: string }>;
  fingerprint: Array<{ name: string; a: unknown; b: unknown; same: boolean }>;
};

/** JSON cannot hold a 25k-char literal — `pad: N` means text = "x".repeat(N). */
function expand(item: { fileName?: string; text?: string; pad?: number }) {
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
  assert.equal(mergeContextAttachments(c.context, c.attachments as never), c.expect, c.name);
  checks++;
}

for (const c of cases.fingerprint) {
  const same = contextAttachmentsFingerprint(c.a as never) === contextAttachmentsFingerprint(c.b as never);
  assert.equal(same, c.same, c.name);
  checks++;
}

// --- nullish / hostile input: the worker takes this straight off the wire ---
for (const bad of [undefined, null, "nope", 7, {}, [null], [undefined], [{}], [{ text: null }]]) {
  assert.deepEqual(normalizeContextAttachments(bad as never), [], `nullish ${JSON.stringify(bad)}`);
  checks++;
}
assert.equal(mergeContextAttachments(undefined, undefined), "", "undefined/undefined merges to empty");
assert.equal(mergeContextAttachments("typed", null), "typed", "null attachments preserve typed text");
checks += 2;

// --- the total cap is what actually bounds the prompt ---
{
  const many = Array.from({ length: 20 }, (_, i) => ({
    fileName: `f${i}.txt`,
    text: "y".repeat(MAX_CONTEXT_ATTACHMENT_CHARS),
  }));
  const out = normalizeContextAttachments(many);
  assert.ok(out.length <= MAX_CONTEXT_ATTACHMENTS, "file count capped");
  const total = out.reduce((n, a) => n + a.text.length, 0);
  assert.ok(
    total <= MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS,
    `total ${total} exceeds cap ${MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS}`,
  );
  const merged = mergeContextAttachments("typed note", many);
  // Headers and separators add a bounded amount on top of the text budget.
  assert.ok(
    merged.length < MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS + 1000,
    "merged string stays bounded",
  );
  checks += 3;
}

// --- idempotence: re-normalizing an already-normalized list is a no-op ---
{
  // Projected so a failure prints three fields, not 20k characters of padding.
  const shape = (list: ReturnType<typeof normalizeContextAttachments>) =>
    list.map((a) => ({ fileName: a.fileName, len: a.text.length, truncated: !!a.truncated }));
  const once = normalizeContextAttachments([
    { fileName: "a.txt", text: "Channel mix is email and chat." },
    { fileName: "b.xlsx", text: "x".repeat(30_000) },
  ]);
  const twice = normalizeContextAttachments(once);
  assert.deepEqual(shape(twice), shape(once), "normalize is idempotent");
  assert.ok(
    once.every((a, i) => a.text === twice[i].text),
    "idempotent normalize does not alter text",
  );
  assert.equal(once[1].truncated, true, "the truncated flag survives a second pass");
  checks += 3;
}

// --- attach order is preserved, and it is load-bearing for merge output ---
{
  const a = mergeContextAttachments("n", [
    { fileName: "1.txt", text: "first file body text here" },
    { fileName: "2.txt", text: "second file body text here" },
  ]);
  const b = mergeContextAttachments("n", [
    { fileName: "2.txt", text: "second file body text here" },
    { fileName: "1.txt", text: "first file body text here" },
  ]);
  assert.notEqual(a, b, "merge respects attach order");
  assert.ok(a.indexOf("1.txt") < a.indexOf("2.txt"), "first attached appears first");
  checks += 2;
}

// --- CACHE-KEY CONTRACT ---
// The research cache key must be unchanged when there are no attachments, or every
// SE's warm cache is invalidated by shipping this feature.
{
  const base: PrepInput = {
    companyName: "Acme",
    companyDomain: "acme.com",
    prospectEmail: "sam@acme.com",
    additionalContext: "AE says renewal is Q3.",
  };
  const emails = ["sam@acme.com"];

  const noAtt = computeInputHash(base, emails);
  assert.equal(
    computeInputHash({ ...base, contextAttachments: [] }, emails),
    noAtt,
    "empty attachments do not change the hash",
  );
  assert.equal(
    computeInputHash({ ...base, contextAttachments: [{ fileName: "junk.pdf", text: "x" }] }, emails),
    noAtt,
    "an unusable attachment does not change the hash",
  );

  const withAtt = computeInputHash(
    { ...base, contextAttachments: [{ fileName: "a.txt", text: "Channel mix is email and chat." }] },
    emails,
  );
  assert.notEqual(withAtt, noAtt, "a real attachment changes the hash");

  const otherAtt = computeInputHash(
    { ...base, contextAttachments: [{ fileName: "a.txt", text: "Channel mix is email and voice." }] },
    emails,
  );
  assert.notEqual(otherAtt, withAtt, "changing attachment text changes the hash");

  // Same effective context reached two ways must hash the same: this is what lets the
  // browser hash (which merges before hashing) agree with the worker hash.
  const typedInline = computeInputHash(
    {
      ...base,
      additionalContext: mergeContextAttachments(base.additionalContext, [
        { fileName: "a.txt", text: "Channel mix is email and chat." },
      ]),
    },
    emails,
  );
  assert.equal(typedInline, withAtt, "merged-inline context hashes the same as attachments");

  // The payload key set must not change shape — JSON.stringify order is the hash.
  assert.deepEqual(
    Object.keys(buildInputHashPayload({ ...base, contextAttachments: [{ fileName: "a.txt", text: "Channel mix is email and chat." }] }, emails)),
    ["companyDomain", "companyName", "emails", "playbookVersion", "linkedin", "kaiaRef", "contextFp"],
    "hash payload key order is stable",
  );
  checks += 7;
}

console.log(`test-context-attachments.ts: ok (${checks} checks)`);
