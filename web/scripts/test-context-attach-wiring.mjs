/**
 * Wiring checks for Additional-context attachments: the markup exists inside the
 * Additional context block, and precall.js actually sends / hashes / clears it.
 *
 * These are string assertions because precall.js pulls in Firebase transitively and
 * cannot be imported under node — the same approach test-user-menu.mjs takes.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(WEB_ROOT, "index.html"), "utf8");
const js = await readFile(join(WEB_ROOT, "precall.js"), "utf8");
const css = await readFile(join(WEB_ROOT, "precall.css"), "utf8");

// The control must sit inside the Additional context area, not in the LinkedIn column —
// the request was to attach files *to Additional context*.
const optionalBlock = html.slice(
  html.indexOf('id="additionalContext"'),
  html.indexOf('id="generate"'),
);

const checks = [
  ["file input exists", html.includes('id="prep-context-files"')],
  ["attach button exists", html.includes('id="prep-context-add-btn"')],
  // A native <button> without type="button" submits the form it sits in, so clicking
  // "Attach files" would fire Generate instead of opening the picker.
  [
    "attach button is type=button",
    /<button[^>]*type="button"[^>]*id="prep-context-add-btn"|<button[^>]*id="prep-context-add-btn"[^>]*type="button"/.test(
      html,
    ),
  ],
  [
    "attach button is native, not fw-button",
    !/<fw-button[^>]*id="prep-context-add-btn"/.test(html),
  ],
  ["file list exists", html.includes('id="prep-context-file-list"')],
  ["error line exists", html.includes('id="prep-context-error"')],
  ["parsing indicator exists", html.includes('id="prep-context-parsing"')],
  ["multiple files allowed", /id="prep-context-files"[\s\S]{0,400}?multiple/.test(html)],
  [
    "input is hidden (the fw-button is the affordance)",
    /id="prep-context-files"[\s\S]{0,400}?hidden/.test(html),
  ],
  [
    "control sits under Additional context",
    optionalBlock.includes('id="prep-context-add-btn"'),
  ],
  ["file list has an accessible name", /id="prep-context-file-list"[^>]*aria-label=/.test(html)],
];

// Every format we claim to support must be offered by the picker, or the user has to
// switch the dialog to "All files" to find their own document.
for (const ext of [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".csv", ".md"]) {
  checks.push([
    `accept offers ${ext}`,
    new RegExp(`id="prep-context-files"[\\s\\S]{0,400}?accept="[^"]*\\${ext}`).test(html),
  ]);
}

checks.push(
  ["payload builder imported", js.includes("contextAttachmentsForPayload")],
  ["upload initialised", js.includes("initContextFileUpload(")],
  ["attachments sent to the worker", /contextAttachments,\r?\n\s+prepType/.test(js)],
  [
    "hash uses the merged context, not the raw field",
    /additionalContext: mergeContextAttachments\(additionalContext, contextAttachments\)/.test(js),
  ],
  [
    "render path merges attachments for the SE-context pass",
    /const context = mergeContextAttachments\(/.test(js),
  ],
  ["bag cleared after a successful generate", js.includes("clearContextAttachments()")],
  ["list cleared after a successful generate", js.includes('$("prep-context-file-list")')],
  // A submit fired mid-parse would post without the file the SE just attached.
  ["submit blocked while parsing", js.includes("isParsingAttachments()")],
  [
    "parsing gate covers both uploaders",
    /function isParsingAttachments\(\)\s*\{\s*return state\.linkedinParsing \|\| state\.contextParsing;/.test(
      js,
    ),
  ],
  ["attach button disabled while generating", js.includes('$("prep-context-add-btn")')],
  ["styles present", css.includes(".prep-context-upload")],
  // Link affordance: a clear-fill fw-button rendered as dark 600-weight body text and
  // read as a field label, which is why this is a native button now.
  ["attach control is brand-coloured", /\.prep-context-attach\s*\{[^}]*var\(--dew-brand\)/.test(css)],
  ["attach control has a focus ring", css.includes(".prep-context-attach:focus-visible")],
  ["attach control has a disabled state", css.includes(".prep-context-attach:disabled")],
  // The hint shares a flex row with the button and the parsing indicator; without a
  // min-width:0 flex item it pushes the indicator out of the card.
  ["hint can shrink in its flex row", /\.prep-context-hint\s*\{[^}]*min-width:\s*0/.test(css)],
);

// Attachment text must NOT be persisted in the compacted brief record: 5 files x 40k
// chars per brief would threaten the localStorage quota.
const storedInput = js.slice(js.indexOf("const storedInput = {"), js.indexOf("pushBriefRecord({"));
checks.push([
  "attachment text is not written into the stored brief",
  !/contextAttachments:/.test(storedInput),
]);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}
if (failed) {
  console.error(`test-context-attach-wiring.mjs: ${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`test-context-attach-wiring.mjs: ok (${checks.length} checks)`);
