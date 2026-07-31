/**
 * Additional-context attachments — extract text from SE-supplied files in the browser.
 *
 * Only text ever leaves the machine: the worker receives `{ fileName, text }` and never
 * the bytes. Supported: PDF, DOCX, PPTX, XLSX/XLSM, and plain-text family (txt, md,
 * csv, tsv, json, log, vtt, yaml).
 *
 * The OOXML parsers here are deliberately plain functions over XML strings so they can
 * be unit-tested without a CDN or a real zip — see scripts/test-prep-context-files.mjs.
 * Caps and merge rules live in prep-context-attachments.js (mirrored in the worker).
 */

import { extractTextFromPdfFile } from "./prep-linkedin-pdf.js";
import {
  MAX_CONTEXT_ATTACHMENTS,
  MAX_CONTEXT_ATTACHMENT_CHARS,
  MIN_CONTEXT_ATTACHMENT_CHARS,
  contextAttachmentsFingerprint,
  normalizeContextAttachments,
} from "./prep-context-attachments.js";

/** Bytes, pre-extraction. Spreadsheets and decks are far heavier than a LinkedIn PDF. */
export const MAX_CONTEXT_FILE_BYTES = 8 * 1024 * 1024;
/** Guard against a pathological sheet producing a million-column line. */
const MAX_SHEET_COLUMNS = 64;

const TEXT_EXTS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "log",
  "vtt",
  "srt",
  "yml",
  "yaml",
]);

/** Formats we cannot read in-browser, with the action that fixes it. */
const REJECTED_EXTS = {
  doc: "legacy Word format — re-save as .docx",
  xls: "legacy Excel format — re-save as .xlsx",
  ppt: "legacy PowerPoint format — re-save as .pptx",
  rtf: "rich text — re-save as .docx or .txt",
  pages: "Apple Pages — export as PDF or .docx",
  numbers: "Apple Numbers — export as .xlsx or .csv",
  key: "Apple Keynote — export as PDF or .pptx",
  msg: "Outlook message — paste the body into Additional context",
  eml: "email file — paste the body into Additional context",
  zip: "archive — attach the files inside it",
};

export const CONTEXT_FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xlsm",
  ...[...TEXT_EXTS].map((e) => `.${e}`),
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
].join(",");

export function fileExtension(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * @param {string} fileName
 * @param {string} [mimeType]
 * @returns {{ kind: "pdf"|"docx"|"pptx"|"xlsx"|"text"|null, ext: string, reason?: string }}
 */
export function classifyContextFile(fileName, mimeType = "") {
  const ext = fileExtension(fileName);
  const mime = String(mimeType || "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") return { kind: "pdf", ext: ext || "pdf" };
  if (ext === "docx" || mime.includes("wordprocessingml")) return { kind: "docx", ext: ext || "docx" };
  if (ext === "pptx" || mime.includes("presentationml")) return { kind: "pptx", ext: ext || "pptx" };
  if (ext === "xlsx" || ext === "xlsm" || mime.includes("spreadsheetml")) {
    return { kind: "xlsx", ext: ext || "xlsx" };
  }
  if (TEXT_EXTS.has(ext)) return { kind: "text", ext };

  if (REJECTED_EXTS[ext]) return { kind: null, ext, reason: REJECTED_EXTS[ext] };
  // Trust an explicit text/* MIME only after the extension checks, so a .docx served
  // as text/plain is not shredded into raw zip bytes.
  if (mime.startsWith("text/")) return { kind: "text", ext: ext || "txt" };
  return {
    kind: null,
    ext,
    reason: ext ? `.${ext} is not supported` : "unrecognised file type",
  };
}

// ---------------------------------------------------------------- XML helpers

const XML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function decodeXmlEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function collapseBlankLines(s) {
  return String(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Walk an OOXML part in document order, keeping only text runs and structural breaks.
 *
 * A tag-strip would work for text but would lose every paragraph boundary, turning a
 * table of support volumes into one unreadable line — so breaks are matched explicitly
 * and everything else is dropped.
 *
 * @param {string} xml
 * @param {{ textTag: string, paraTag: string, tabTag?: string, breakTag?: string }} tags
 */
export function ooxmlPartToText(xml, tags) {
  const src = String(xml || "");
  if (!src) return "";
  const { textTag, paraTag, tabTag, breakTag } = tags;

  // `<w:t\b` cannot match `<w:tab` — "t" followed by "a" is not a word boundary — so
  // the text alternative is safe to place first.
  const parts = [`<${textTag}\\b[^>]*>([\\s\\S]*?)<\\/${textTag}>`, `<\\/${paraTag}>`];
  if (tabTag) parts.push(`<${tabTag}\\b[^>]*\\/?>`);
  if (breakTag) parts.push(`<${breakTag}\\b[^>]*\\/?>`);
  const re = new RegExp(parts.join("|"), "g");

  let out = "";
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) {
      out += decodeXmlEntities(m[1]);
      continue;
    }
    const tag = m[0];
    if (tabTag && tag.startsWith(`<${tabTag}`)) out += "\t";
    else out += "\n";
  }
  return collapseBlankLines(out);
}

export function docxTextFromXml(xml) {
  return ooxmlPartToText(xml, {
    textTag: "w:t",
    paraTag: "w:p",
    tabTag: "w:tab",
    breakTag: "w:br",
  });
}

export function pptxTextFromXml(xml) {
  return ooxmlPartToText(xml, { textTag: "a:t", paraTag: "a:p", breakTag: "a:br" });
}

/** slide2 before slide10 — plain string sort puts slide10 first. */
export function sortedSlidePaths(names) {
  return [...names]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

function slideNumber(path) {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------- xlsx parsing

/** "AB12" -> 27 (0-based column). */
export function cellColumnIndex(ref) {
  const m = /^([A-Z]+)/i.exec(String(ref || ""));
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `<si>` entries, each of which may hold several `<t>` runs (rich text). */
export function sharedStringsFromXml(xml) {
  const src = String(xml || "");
  return [...src.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXmlEntities(t[1]))
      .join(""),
  );
}

/** Built-in numFmtIds that render as a date and/or time. */
const DATE_NUMFMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * cellXfs index -> is this a date format? Needed because a date cell holds a bare
 * serial number, and "45678" as a support-volume date helps nobody.
 */
export function dateStyleFlagsFromXml(stylesXml) {
  const src = String(stylesXml || "");
  const customDateIds = new Set();
  for (const m of src.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    // Strip quoted literals and colour/condition blocks before sniffing for d/m/y.
    const code = m[2].replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    if (/[dy]/i.test(code) || /\bh{1,2}\b|hh?:mm/i.test(code)) customDateIds.add(Number(m[1]));
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(src)?.[1] || "";
  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? -1);
    return DATE_NUMFMT_IDS.has(id) || customDateIds.has(id);
  });
}

/** Excel serial (1899-12-30 epoch) -> ISO date, or date+time for fractional serials. */
export function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return String(serial);
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return Number.isInteger(n) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * One worksheet -> tab-separated lines. Column letters are honoured so gaps do not
 * shift a row's values into the wrong column.
 *
 * @param {string} sheetXml
 * @param {string[]} sharedStrings
 * @param {boolean[]} dateFlags
 */
export function sheetXmlToLines(sheetXml, sharedStrings = [], dateFlags = []) {
  const src = String(sheetXml || "");
  const lines = [];

  for (const rowMatch of src.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    let maxCol = -1;

    for (const cm of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || "";
      const body = cm[2] || "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] || "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || "n";
      const styleIdx = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const col = ref ? cellColumnIndex(ref) : maxCol + 1;
      if (col >= MAX_SHEET_COLUMNS) continue;

      const value = cellValue(type, body, styleIdx, sharedStrings, dateFlags);
      if (value !== "") {
        cells[col] = value;
        if (col > maxCol) maxCol = col;
      } else if (col > maxCol) {
        maxCol = col;
      }
    }

    if (maxCol < 0) continue;
    const line = Array.from({ length: maxCol + 1 }, (_, i) => cells[i] ?? "").join("\t");
    if (line.trim()) lines.push(line.replace(/\t+$/, ""));
  }

  return lines;
}

function cellValue(type, body, styleIdx, sharedStrings, dateFlags) {
  const rawV = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];

  if (type === "s") {
    const idx = Number(rawV);
    return Number.isFinite(idx) ? String(sharedStrings[idx] ?? "").trim() : "";
  }
  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => decodeXmlEntities(m[1]))
      .join("")
      .trim();
  }
  if (type === "b") return rawV === "1" ? "TRUE" : rawV === "0" ? "FALSE" : "";
  if (type === "str" || type === "e") return decodeXmlEntities(rawV ?? "").trim();

  if (rawV === undefined) return "";
  const num = decodeXmlEntities(rawV).trim();
  if (dateFlags[styleIdx] && /^-?\d+(\.\d+)?$/.test(num)) return excelSerialToIso(num);
  return num;
}

/**
 * @param {{ sharedStrings?: string, styles?: string, sheets: Array<{ name: string, xml: string }> }} parts
 */
export function xlsxTextFromParts(parts) {
  const shared = sharedStringsFromXml(parts?.sharedStrings);
  const dateFlags = dateStyleFlagsFromXml(parts?.styles);
  const blocks = [];

  for (const sheet of parts?.sheets || []) {
    const lines = sheetXmlToLines(sheet.xml, shared, dateFlags);
    if (!lines.length) continue;
    blocks.push(`# Sheet: ${sheet.name}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n").trim();
}

/** Worksheet path -> display name, via workbook.xml + its rels. */
export function sheetNamesFromWorkbook(workbookXml, relsXml) {
  const relById = new Map();
  for (const m of String(relsXml || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relById.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const out = [];
  for (const m of String(workbookXml || "").matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXmlEntities(/name="([^"]*)"/.exec(m[0])?.[1] || "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] || "";
    const target = relById.get(rid);
    if (name && target) out.push({ name, path: `xl/${target}` });
  }
  return out;
}

// ---------------------------------------------------------------- extraction

/** @type {Promise<{ unzipSync: Function }>|null} */
let fflateLoadPromise = null;

async function loadUnzip() {
  if (!fflateLoadPromise) {
    fflateLoadPromise = import("https://esm.sh/fflate@0.8.2").catch((err) => {
      fflateLoadPromise = null;
      throw new Error(`could not load the Office file reader (${err?.message || "offline"})`);
    });
  }
  return fflateLoadPromise;
}

async function unzipEntries(file) {
  const { unzipSync } = await loadUnzip();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("file is corrupt or not a real Office document");
  }
  return entries;
}

function decodeEntry(entries, path) {
  const bytes = entries?.[path];
  if (!bytes) return "";
  return new TextDecoder("utf-8").decode(bytes);
}

async function extractDocx(file) {
  const entries = await unzipEntries(file);
  const body = docxTextFromXml(decodeEntry(entries, "word/document.xml"));
  if (body) return body;
  throw new Error("no text found — the document may be empty or image-only");
}

async function extractPptx(file) {
  const entries = await unzipEntries(file);
  const slides = sortedSlidePaths(Object.keys(entries));
  const blocks = slides
    .map((path, i) => {
      const text = pptxTextFromXml(decodeEntry(entries, path));
      return text ? `# Slide ${i + 1}\n${text}` : "";
    })
    .filter(Boolean);
  if (blocks.length) return blocks.join("\n\n");
  throw new Error("no text found — the slides may be images only");
}

async function extractXlsx(file) {
  const entries = await unzipEntries(file);
  const names = sheetNamesFromWorkbook(
    decodeEntry(entries, "xl/workbook.xml"),
    decodeEntry(entries, "xl/_rels/workbook.xml.rels"),
  );
  const sheetList = names.length
    ? names
    : Object.keys(entries)
        .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort()
        .map((path, i) => ({ name: `Sheet${i + 1}`, path }));

  const text = xlsxTextFromParts({
    sharedStrings: decodeEntry(entries, "xl/sharedStrings.xml"),
    styles: decodeEntry(entries, "xl/styles.xml"),
    sheets: sheetList.map((s) => ({ name: s.name, xml: decodeEntry(entries, s.path) })),
  });
  if (text) return text;
  throw new Error("no cell values found — the workbook may be empty");
}

async function extractPlainText(file) {
  const raw = await file.text();
  // A binary file mislabelled as text shows up as replacement characters; refuse it
  // rather than posting mojibake to the model.
  const sample = raw.slice(0, 4000);
  const junk = (sample.match(/�/g) || []).length;
  if (junk > 8 && junk / Math.max(sample.length, 1) > 0.01) {
    throw new Error("does not look like text — check the file type");
  }
  return collapseBlankLines(raw);
}

/**
 * @param {File} file
 * @returns {Promise<{ text: string, kind: string }>}
 */
export async function extractTextFromContextFile(file) {
  const { kind, reason } = classifyContextFile(file?.name || "", file?.type || "");
  if (!kind) throw new Error(reason || "unsupported file type");

  let text = "";
  if (kind === "pdf") text = await extractTextFromPdfFile(file);
  else if (kind === "docx") text = await extractDocx(file);
  else if (kind === "pptx") text = await extractPptx(file);
  else if (kind === "xlsx") text = await extractXlsx(file);
  else text = await extractPlainText(file);

  return { text: String(text || "").trim(), kind };
}

// ---------------------------------------------------------------- attachment bag

/** @type {Record<string, import('./prep-context-attachments.js').ContextAttachment[]>} */
const bags = { prep: [] };

function bagOf(bag = "prep") {
  if (!bags[bag]) bags[bag] = [];
  return bags[bag];
}

export function getContextAttachments(bag = "prep") {
  return bagOf(bag).map(({ fileName, text, truncated }) => ({
    fileName,
    text,
    truncated: !!truncated,
  }));
}

export function clearContextAttachments(bag = "prep") {
  bags[bag] = [];
}

export function removeContextAttachment(fileName, bag = "prep") {
  bags[bag] = bagOf(bag).filter((a) => a.fileName !== fileName);
}

/**
 * Extract and stage files. Errors are per-file so one bad attachment does not discard
 * the good ones alongside it.
 *
 * @param {File[]} files
 * @param {string} [bag]
 * @returns {Promise<{ added: number, errors: string[] }>}
 */
export async function addContextFiles(files, bag = "prep") {
  const errors = [];
  let added = 0;

  for (const file of files) {
    const current = bagOf(bag);
    if (current.length >= MAX_CONTEXT_ATTACHMENTS) {
      errors.push(`Maximum ${MAX_CONTEXT_ATTACHMENTS} attachments.`);
      break;
    }
    const name = file?.name || "attachment";
    if (current.some((a) => a.fileName.toLowerCase() === name.toLowerCase())) {
      errors.push(`${name}: already attached.`);
      continue;
    }
    if (file.size > MAX_CONTEXT_FILE_BYTES) {
      errors.push(`${name}: over ${Math.round(MAX_CONTEXT_FILE_BYTES / 1024 / 1024)} MB.`);
      continue;
    }

    try {
      const { text } = await extractTextFromContextFile(file);
      if (text.length < MIN_CONTEXT_ATTACHMENT_CHARS) {
        errors.push(`${name}: no readable text found.`);
        continue;
      }
      // Re-normalize the whole bag so the shared per-file and total caps decide what
      // is kept — the same rules the worker will apply to the payload.
      const next = normalizeContextAttachments([...current, { fileName: name, text }]);
      if (!next.some((a) => a.fileName === name)) {
        errors.push(`${name}: skipped — the context size limit is already reached.`);
        continue;
      }
      bags[bag] = next;
      added++;
    } catch (err) {
      errors.push(`${name}: ${err?.message || "could not be read"}.`);
    }
  }

  return { added, errors };
}

/** Payload for the worker API. */
export function contextAttachmentsForPayload(bag = "prep") {
  const items = normalizeContextAttachments(bagOf(bag));
  if (!items.length) return undefined;
  return items.map(({ fileName, text }) => ({ fileName, text }));
}

export function contextFilesFingerprint(bag = "prep") {
  return contextAttachmentsFingerprint(bagOf(bag));
}

/** Human summary for the file chip: "notes.docx · 3.2k chars". */
export function attachmentSummary(attachment) {
  const chars = String(attachment?.text || "").length;
  const size = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
  return attachment?.truncated ? `${size} · trimmed` : size;
}

// ---------------------------------------------------------------- UI wiring

/**
 * @param {{
 *   bag?: string,
 *   fileInputId?: string,
 *   addBtnId?: string,
 *   listElId?: string,
 *   errElId?: string,
 *   parsingElId?: string,
 *   onListChange?: () => void,
 *   setParsing?: (on: boolean) => void,
 * }} [opts]
 */
export function initContextFileUpload(opts = {}) {
  const bag = opts.bag || "prep";
  const fileInput = document.getElementById(opts.fileInputId || "prep-context-files");
  const addBtn = document.getElementById(opts.addBtnId || "prep-context-add-btn");
  const listEl = document.getElementById(opts.listElId || "prep-context-file-list");
  const errEl = document.getElementById(opts.errElId || "prep-context-error");
  const parsingEl = document.getElementById(opts.parsingElId || "prep-context-parsing");

  const renderList = () => {
    if (listEl) {
      const items = getContextAttachments(bag);
      listEl.innerHTML = items
        .map(
          (a) => `<li class="prep-linkedin-file-item">
          <span class="prep-linkedin-file-name" title="${escapeAttr(a.fileName)}">${escapeHtml(a.fileName)} <span class="prep-linkedin-file-meta">(${escapeHtml(attachmentSummary(a))})</span></span>
          <fw-button type="button" color="secondary" fill="clear" size="small" data-remove-context="${escapeAttr(a.fileName)}">Remove</fw-button>
        </li>`,
        )
        .join("");
      listEl.querySelectorAll("[data-remove-context]").forEach((btn) => {
        btn.addEventListener("fwClick", () => {
          removeContextAttachment(btn.getAttribute("data-remove-context"), bag);
          renderList();
        });
      });
    }
    opts.onListChange?.();
  };

  // The prep form uses a native <button>; postcall or a future host may pass an
  // fw-button. Bind exactly one event either way — fw-button emits fwClick *and* lets
  // the native click bubble, so binding both opens the picker twice and Chrome
  // discards the first selection.
  if (addBtn) {
    const evt = addBtn.tagName?.startsWith("FW-") ? "fwClick" : "click";
    addBtn.addEventListener(evt, () => fileInput?.click());
  }

  fileInput?.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (!files.length) return;
    if (errEl) errEl.hidden = true;
    if (parsingEl) parsingEl.hidden = false;
    opts.setParsing?.(true);
    try {
      const { errors } = await addContextFiles(files, bag);
      if (errors.length && errEl) {
        errEl.textContent = errors.join(" ");
        errEl.hidden = false;
      }
      renderList();
    } finally {
      if (parsingEl) parsingEl.hidden = true;
      opts.setParsing?.(false);
    }
  });

  renderList();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export { MAX_CONTEXT_ATTACHMENTS, MAX_CONTEXT_ATTACHMENT_CHARS };
