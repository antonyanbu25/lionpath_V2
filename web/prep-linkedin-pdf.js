/**
 * LinkedIn "Save to PDF" attachments — extract text in browser, enforce limits.
 */

export const MAX_LINKEDIN_PDF_FILES = 5;
export const MAX_LINKEDIN_PDF_BYTES = 2 * 1024 * 1024;
export const MAX_LINKEDIN_TEXT_CHARS = 20_000;
export const STORED_LINKEDIN_TEXT_CHARS = 8_000;

/** @type {{ fileName: string, text: string, truncated?: boolean }[]} */
let attachments = [];

/** @type {Promise<typeof import('pdfjs-dist')>|null} */
let pdfjsLoadPromise = null;

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

export function getLinkedInAttachments() {
  return attachments.map(({ fileName, text, truncated }) => ({
    fileName,
    text,
    truncated: !!truncated,
  }));
}

export function clearLinkedInAttachments() {
  attachments = [];
}

/**
 * @param {File[]} files
 * @returns {Promise<{ added: number, errors: string[] }>}
 */
export async function addLinkedInPdfFiles(files) {
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

export function removeLinkedInAttachment(fileName) {
  attachments = attachments.filter((a) => a.fileName !== fileName);
}

/** Payload for worker API. */
export function linkedinProfileExportsForPayload() {
  if (!attachments.length) return undefined;
  return attachments.map(({ fileName, text }) => ({ fileName, text }));
}

/** Truncated copy for PrepBrief.input storage. */
export function linkedinProfileExportsForStorage() {
  if (!attachments.length) return undefined;
  return attachments.map(({ fileName, text }) => {
    const { text: stored } = truncateLinkedInText(text, STORED_LINKEDIN_TEXT_CHARS);
    return { fileName, text: stored };
  });
}

export function linkedinFingerprintForHash() {
  return getLinkedInAttachments()
    .map((e) => `${e.fileName}:${e.text.length}:${e.text.slice(0, 200)}`)
    .sort()
    .join("|");
}

/**
 * Wire pre-call LinkedIn PDF upload UI.
 * @param {{ onListChange?: () => void, setParsing?: (on: boolean) => void }} [opts]
 */
export function initLinkedInPdfUpload(opts = {}) {
  const fileInput = document.getElementById("prep-linkedin-pdfs");
  const addBtn = document.getElementById("prep-linkedin-add-btn");
  const listEl = document.getElementById("prep-linkedin-file-list");
  const errEl = document.getElementById("prep-linkedin-error");
  const parsingEl = document.getElementById("prep-linkedin-parsing");

  const renderList = () => {
    if (!listEl) return;
    const items = getLinkedInAttachments();
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
        removeLinkedInAttachment(btn.getAttribute("data-remove-linkedin"));
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
      const { errors } = await addLinkedInPdfFiles(files);
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
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
