/**
 * LinkedIn "Save to PDF" attachments — extract text in browser, enforce limits.
 * Supports separate prep / postcall bags so both forms can use the same control.
 */

export const MAX_LINKEDIN_PDF_FILES = 5;
export const MAX_LINKEDIN_PDF_BYTES = 2 * 1024 * 1024;
export const MAX_LINKEDIN_TEXT_CHARS = 20_000;
export const STORED_LINKEDIN_TEXT_CHARS = 8_000;

/** @typedef {{ fileName: string, text: string, truncated?: boolean }} LinkedInAttachment */

/** @type {Record<string, LinkedInAttachment[]>} */
const bags = {
  prep: [],
  postcall: [],
};

/** @type {Promise<typeof import('pdfjs-dist')>|null} */
let pdfjsLoadPromise = null;

function bagOf(bag = "prep") {
  if (!bags[bag]) bags[bag] = [];
  return bags[bag];
}

async function loadPdfJs() {
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = import(
      "https://esm.sh/pdfjs-dist@4.4.168/build/pdf.mjs"
    ).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc =
        "https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs";
      return pdfjs;
    });
  }
  return pdfjsLoadPromise;
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractTextFromPdfFile(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    parts.push(pageText);
  }
  return parts.join("\n\n").replace(/\s+\n/g, "\n").trim();
}

export function truncateLinkedInText(text, maxChars = MAX_LINKEDIN_TEXT_CHARS) {
  const s = String(text || "").trim();
  if (s.length <= maxChars) return { text: s, truncated: false };
  return { text: s.slice(0, maxChars), truncated: true };
}

/** @param {string} [bag] */
export function getLinkedInAttachments(bag = "prep") {
  return bagOf(bag).map(({ fileName, text, truncated }) => ({
    fileName,
    text,
    truncated: !!truncated,
  }));
}

/** @param {string} [bag] */
export function clearLinkedInAttachments(bag = "prep") {
  bags[bag] = [];
  if (bag === "prep") emailFileMap.clear();
}

/**
 * @param {File[]} files
 * @param {string} [bag]
 * @returns {Promise<{ added: number, errors: string[] }>}
 */
export async function addLinkedInPdfFiles(files, bag = "prep") {
  const attachments = bagOf(bag);
  const errors = [];
  let added = 0;
  const existingNames = new Set(attachments.map((a) => a.fileName.toLowerCase()));

  for (const file of files) {
    if (attachments.length >= MAX_LINKEDIN_PDF_FILES) {
      errors.push(`Maximum ${MAX_LINKEDIN_PDF_FILES} PDFs allowed.`);
      break;
    }
    const name = file.name || "profile.pdf";
    if (!/\.pdf$/i.test(name) && file.type !== "application/pdf") {
      errors.push(`${name}: not a PDF file.`);
      continue;
    }
    if (file.size > MAX_LINKEDIN_PDF_BYTES) {
      errors.push(`${name}: exceeds 2 MB limit.`);
      continue;
    }
    if (existingNames.has(name.toLowerCase())) {
      errors.push(`${name}: already attached.`);
      continue;
    }

    try {
      let text = await extractTextFromPdfFile(file);
      if (!text || text.length < 40) {
        errors.push(`${name}: could not extract text (empty or scanned PDF).`);
        continue;
      }
      const { text: capped, truncated } = truncateLinkedInText(text);
      attachments.push({ fileName: name, text: capped, truncated });
      existingNames.add(name.toLowerCase());
      added++;
    } catch (err) {
      errors.push(`${name}: ${err?.message || "failed to read PDF"}.`);
    }
  }

  return { added, errors };
}

/** @param {string} fileName @param {string} [bag] */
export function removeLinkedInAttachment(fileName, bag = "prep") {
  bags[bag] = bagOf(bag).filter((a) => a.fileName !== fileName);
}

/** Payload for worker API. @param {string} [bag] */
export function linkedinProfileExportsForPayload(bag = "prep") {
  const attachments = bagOf(bag);
  if (!attachments.length) return undefined;
  return attachments.map(({ fileName, text }) => ({ fileName, text }));
}

/** Truncated copy for PrepBrief.input storage. @param {string} [bag] */
export function linkedinProfileExportsForStorage(bag = "prep") {
  const attachments = bagOf(bag);
  if (!attachments.length) return undefined;
  return attachments.map(({ fileName, text }) => {
    const { text: stored } = truncateLinkedInText(text, STORED_LINKEDIN_TEXT_CHARS);
    return { fileName, text: stored };
  });
}

/** @param {string} [bag] */
export function linkedinFingerprintForHash(bag = "prep") {
  return getLinkedInAttachments(bag)
    .map((e) => `${e.fileName}:${e.text.length}:${e.text.slice(0, 200)}`)
    .sort()
    .join("|");
}

/** @type {Map<string, string>} prep bag email (lower) -> attached fileName */
const emailFileMap = new Map();

function findAttachmentForEmail(email, bag = "prep") {
  const key = String(email || "").toLowerCase();
  const mapped = emailFileMap.get(key);
  if (mapped) {
    return getLinkedInAttachments(bag).find((a) => a.fileName === mapped) || null;
  }
  return null;
}

/**
 * Render per-attendee LinkedIn upload rows (New pre-call brief design).
 * @param {string[]} emails
 * @param {{ bag?: string, hostId?: string, onListChange?: () => void }} [opts]
 */
export function renderPrepAttendeeRows(emails, opts = {}) {
  const host = document.getElementById(opts.hostId || "prep-linkedin-attendees");
  if (!host) return;
  const bag = opts.bag || "prep";
  const list = (emails || []).filter(Boolean);
  if (!list.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = list
    .map((email) => {
      const att = findAttachmentForEmail(email, bag);
      if (att) {
        return `<div class="nb-linkedin-row" data-email="${escapeAttr(email)}">
          <span class="nb-field-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
          <span class="nb-linkedin-row-email">${escapeHtml(email)}</span>
          <span class="nb-linkedin-uploaded" title="${escapeAttr(att.fileName)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
            ${escapeHtml(att.fileName)}
          </span>
          <button type="button" class="nb-linkedin-upload-btn" data-upload-email="${escapeAttr(email)}">Replace</button>
        </div>`;
      }
      return `<div class="nb-linkedin-row" data-email="${escapeAttr(email)}">
        <span class="nb-field-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
        <span class="nb-linkedin-row-email">${escapeHtml(email)}</span>
        <button type="button" class="nb-linkedin-upload-btn" data-upload-email="${escapeAttr(email)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          Upload LinkedIn PDF
        </button>
      </div>`;
    })
    .join("");

  host.querySelectorAll("[data-upload-email]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const email = btn.getAttribute("data-upload-email");
      if (email && host.__pickLinkedIn) host.__pickLinkedIn(email);
    });
  });
  opts.onListChange?.();
}

/** Clear email→file associations for a bag. */
export function clearPrepAttendeeLinkedIn() {
  emailFileMap.clear();
  const host = document.getElementById("prep-linkedin-attendees");
  if (host) host.innerHTML = "";
}

/**
 * Per-attendee LinkedIn upload for prep form.
 * @param {{
 *   bag?: string,
 *   fileInputId?: string,
 *   hostId?: string,
 *   emailFieldId?: string,
 *   errElId?: string,
 *   parsingElId?: string,
 *   onListChange?: () => void,
 *   setParsing?: (on: boolean) => void,
 * }} [opts]
 */
export function initPrepAttendeeLinkedIn(opts = {}) {
  const bag = opts.bag || "prep";
  loadPdfJs().catch(() => {});
  const fileInput = document.getElementById(opts.fileInputId || "prep-linkedin-pdfs");
  const host = document.getElementById(opts.hostId || "prep-linkedin-attendees");
  const emailField = document.getElementById(opts.emailFieldId || "prospectEmail");
  const errEl = document.getElementById(opts.errElId || "prep-linkedin-error");
  const parsingEl = document.getElementById(opts.parsingElId || "prep-linkedin-parsing");
  /** @type {string|null} */
  let pendingEmail = null;

  const parseEmails = (raw) =>
    String(raw || "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const refreshRows = () => {
    const emails = parseEmails(emailField?.value || "");
    renderPrepAttendeeRows(emails, { bag, hostId: opts.hostId, onListChange: opts.onListChange });
  };

  if (host) {
    host.__pickLinkedIn = (email) => {
      pendingEmail = email;
      fileInput?.click();
    };
  }

  emailField?.addEventListener("fwInput", refreshRows);
  emailField?.addEventListener("input", refreshRows);

  fileInput?.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (!files.length) return;
    if (errEl) errEl.hidden = true;
    if (parsingEl) parsingEl.hidden = false;
    opts.setParsing?.(true);
    try {
      const { errors, added } = await addLinkedInPdfFiles(files, bag);
      if (added > 0 && pendingEmail) {
        const latest = getLinkedInAttachments(bag).at(-1);
        if (latest) emailFileMap.set(pendingEmail.toLowerCase(), latest.fileName);
      }
      pendingEmail = null;
      if (errors.length && errEl) {
        errEl.textContent = errors.join(" ");
        errEl.hidden = false;
      }
      refreshRows();
    } finally {
      if (parsingEl) parsingEl.hidden = true;
      opts.setParsing?.(false);
    }
  });

  refreshRows();
}

/**
 * Wire LinkedIn PDF upload UI (prep or post-call).
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
export function initLinkedInPdfUpload(opts = {}) {
  const bag = opts.bag || "prep";
  loadPdfJs().catch(() => {});
  const fileInput = document.getElementById(opts.fileInputId || "prep-linkedin-pdfs");
  const addBtn = document.getElementById(opts.addBtnId || "prep-linkedin-add-btn");
  const listEl = document.getElementById(opts.listElId || "prep-linkedin-file-list");
  const errEl = document.getElementById(opts.errElId || "prep-linkedin-error");
  const parsingEl = document.getElementById(opts.parsingElId || "prep-linkedin-parsing");

  const renderList = () => {
    if (!listEl) return;
    const items = getLinkedInAttachments(bag);
    listEl.innerHTML = items.length
      ? items
          .map(
            (a) => `<li class="prep-linkedin-file-item">
          <span class="prep-linkedin-file-name" title="${escapeAttr(a.fileName)}">${escapeHtml(a.fileName)}${a.truncated ? ' <span class="prep-linkedin-file-meta">(text trimmed)</span>' : ""}</span>
          <fw-button type="button" color="secondary" fill="clear" size="small" data-remove-linkedin="${escapeAttr(a.fileName)}">Remove</fw-button>
        </li>`,
          )
          .join("")
      : "";
    listEl.querySelectorAll("[data-remove-linkedin]").forEach((btn) => {
      btn.addEventListener("fwClick", () => {
        removeLinkedInAttachment(btn.getAttribute("data-remove-linkedin"), bag);
        renderList();
        opts.onListChange?.();
      });
    });
    opts.onListChange?.();
  };

  addBtn?.addEventListener("fwClick", () => fileInput?.click());
  addBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (!files.length) return;
    if (errEl) errEl.hidden = true;
    if (parsingEl) parsingEl.hidden = false;
    opts.setParsing?.(true);
    try {
      const { errors } = await addLinkedInPdfFiles(files, bag);
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
