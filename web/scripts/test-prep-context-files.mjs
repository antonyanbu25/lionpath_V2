#!/usr/bin/env node
/**
 * Additional-context attachment extraction: file classification and the OOXML/xlsx
 * parsers. Pure — no CDN, no browser.
 *
 * The zip layer (fflate) and pdf.js are exercised by hand in the browser; everything
 * that decides what text the model actually sees is tested here.
 */
import assert from "node:assert/strict";

import {
  CONTEXT_FILE_ACCEPT,
  attachmentSummary,
  cellColumnIndex,
  classifyContextFile,
  dateStyleFlagsFromXml,
  decodeXmlEntities,
  docxTextFromXml,
  excelSerialToIso,
  fileExtension,
  pptxTextFromXml,
  sharedStringsFromXml,
  sheetNamesFromWorkbook,
  sheetXmlToLines,
  sortedSlidePaths,
  xlsxTextFromParts,
} from "../prep-context-files.js";

let checks = 0;
const eq = (a, b, m) => {
  assert.equal(a, b, m);
  checks++;
};
const deep = (a, b, m) => {
  assert.deepEqual(a, b, m);
  checks++;
};

// ---------------------------------------------------------------- classification

eq(fileExtension("Q3 notes.FINAL.docx"), "docx", "extension from a dotted name");
eq(fileExtension("noext"), "", "no extension");

for (const [name, kind] of [
  ["profile.pdf", "pdf"],
  ["notes.docx", "docx"],
  ["deck.pptx", "pptx"],
  ["volumes.xlsx", "xlsx"],
  ["macro.xlsm", "xlsx"],
  ["notes.txt", "text"],
  ["readme.md", "text"],
  ["export.csv", "text"],
  ["data.tsv", "text"],
  ["blob.json", "text"],
  ["call.vtt", "text"],
]) {
  eq(classifyContextFile(name).kind, kind, `${name} -> ${kind}`);
}

// Case-insensitive, and MIME can stand in for a missing extension.
eq(classifyContextFile("NOTES.DOCX").kind, "docx", "uppercase extension");
eq(classifyContextFile("download", "application/pdf").kind, "pdf", "pdf by MIME alone");
eq(
  classifyContextFile("sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .kind,
  "xlsx",
  "xlsx by MIME alone",
);

// A .docx served as text/plain must NOT be read as text, or we post raw zip bytes.
eq(classifyContextFile("notes.docx", "text/plain").kind, "docx", "extension beats a text/* MIME");

// Rejections must name the fix, not just fail.
for (const [name, needle] of [
  ["old.doc", "re-save as .docx"],
  ["old.xls", "re-save as .xlsx"],
  ["old.ppt", "re-save as .pptx"],
  ["note.rtf", "re-save as"],
  ["doc.pages", "export as"],
  ["book.numbers", "export as"],
  ["deck.key", "export as"],
  ["mail.msg", "paste the body"],
  ["archive.zip", "attach the files inside"],
]) {
  const res = classifyContextFile(name);
  eq(res.kind, null, `${name} is rejected`);
  assert.ok(res.reason?.includes(needle), `${name} reason mentions "${needle}": ${res.reason}`);
  checks++;
}
assert.ok(classifyContextFile("thing.xyz").reason.includes(".xyz"), "unknown ext named in reason");
assert.ok(classifyContextFile("").reason, "empty name still yields a reason");
checks += 2;

for (const ext of [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".csv"]) {
  assert.ok(CONTEXT_FILE_ACCEPT.includes(ext), `accept attribute offers ${ext}`);
  checks++;
}

// ---------------------------------------------------------------- xml entities

eq(decodeXmlEntities("A &amp; B &lt;tag&gt; &quot;q&quot; &apos;s&apos;"), `A & B <tag> "q" 's'`, "named entities");
eq(decodeXmlEntities("caf&#233; &#x2014; bar"), "café — bar", "numeric + hex entities");
eq(decodeXmlEntities("&amp;lt;"), "&lt;", "single decode pass, no double-decoding");
eq(decodeXmlEntities(undefined), "", "nullish decodes to empty");

// ---------------------------------------------------------------- docx

{
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Support review</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">They run </w:t></w:r><w:r><w:t>12 agents</w:t></w:r><w:r><w:t> on Zendesk.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Channels:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>email, chat</w:t></w:r></w:p>
    <w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>
    <w:p/>
    <w:p><w:r><w:t>Renewal in Q3 &amp; budget approved</w:t></w:r></w:p>
  </w:body></w:document>`;
  const out = docxTextFromXml(xml);
  const lines = out.split("\n");

  eq(lines[0], "Support review", "heading becomes its own line");
  eq(lines[1], "They run 12 agents on Zendesk.", "runs inside a paragraph join without gaps");
  eq(lines[2], "Channels:\temail, chat", "w:tab becomes a tab, not a lost boundary");
  assert.ok(out.includes("Line one\nLine two"), "w:br breaks the line");
  assert.ok(out.includes("Renewal in Q3 & budget approved"), "entities decoded in body text");
  assert.ok(!/<[a-z/]/i.test(out), `no markup survives: ${out.slice(0, 120)}`);
  assert.ok(!/\n\n\n/.test(out), "empty paragraphs collapse rather than stacking blank lines");
  checks += 4;

  // The bug this parser exists to avoid: paragraph boundaries must survive.
  assert.ok(out.split("\n").length >= 5, "paragraphs are not flattened into one line");
  checks++;
}

// `<w:t\b` must not swallow `<w:tab/>`, and field instructions must not leak.
eq(docxTextFromXml("<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>"), "a\tb", "w:t vs w:tab");
eq(
  docxTextFromXml('<w:p><w:r><w:instrText>PAGEREF _Toc1</w:instrText></w:r><w:r><w:t>Real</w:t></w:r></w:p>'),
  "Real",
  "instrText is not text",
);
eq(docxTextFromXml(""), "", "empty xml yields empty text");
eq(docxTextFromXml(undefined), "", "nullish xml yields empty text");

// ---------------------------------------------------------------- pptx

{
  const slide = `<p:sld xmlns:a="x"><p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Why Freshdesk</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody>
      <a:p><a:pPr lvl="0"/><a:r><a:t>Consolidate email &amp; chat</a:t></a:r></a:p>
      <a:p><a:r><a:t>Cut first-response time</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const out = pptxTextFromXml(slide);
  deep(out.split("\n"), ["Why Freshdesk", "Consolidate email & chat", "Cut first-response time"], "slide bullets");
  // </a:pPr> must not be mistaken for the end of </a:p>.
  assert.ok(!out.startsWith("\n"), "a:pPr does not emit a spurious break");
  checks++;
}

deep(
  sortedSlidePaths([
    "ppt/slides/slide10.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/_rels/slide1.xml.rels",
    "ppt/slides/slide1.xml",
    "docProps/app.xml",
  ]),
  ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"],
  "slides sort numerically and rels are excluded",
);

// ---------------------------------------------------------------- xlsx

deep(
  [cellColumnIndex("A1"), cellColumnIndex("B2"), cellColumnIndex("Z9"), cellColumnIndex("AA1"), cellColumnIndex("AB12")],
  [0, 1, 25, 26, 27],
  "column letters to indices",
);
eq(cellColumnIndex(""), 0, "missing ref falls back to column 0");

deep(
  sharedStringsFromXml(
    `<sst><si><t>Month</t></si><si><t>Tickets</t></si><si><r><t>Rich </t></r><r><t>text</t></r></si><si><t>A &amp; B</t></si></sst>`,
  ),
  ["Month", "Tickets", "Rich text", "A & B"],
  "shared strings, including multi-run rich text",
);

{
  const styles = `<styleSheet>
    <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
    <cellXfs count="4">
      <xf numFmtId="0" fontId="0"/>
      <xf numFmtId="14" fontId="0" applyNumberFormat="1"/>
      <xf numFmtId="164" fontId="0" applyNumberFormat="1"/>
      <xf numFmtId="3" fontId="0" applyNumberFormat="1"/>
    </cellXfs></styleSheet>`;
  const flags = dateStyleFlagsFromXml(styles);
  deep(flags, [false, true, true, false], "builtin 14 and custom y-m-d are dates; #,##0 is not");
}
deep(dateStyleFlagsFromXml(""), [], "no styles part yields no flags");

eq(excelSerialToIso(45658), "2025-01-01", "integer serial to ISO date");
eq(excelSerialToIso(45689), "2025-02-01", "serial arithmetic crosses a month correctly");
eq(excelSerialToIso(45658.5), "2025-01-01 12:00", "fractional serial keeps the time");
eq(excelSerialToIso("notanumber"), "notanumber", "non-numeric passes through");
eq(excelSerialToIso(0), "0", "zero is not a date");

{
  const shared = ["Month", "Tickets", "Channel"];
  const styles = `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" s="1"><v>45658</v></c><c r="B2"><v>4120</v></c><c r="C2" t="inlineStr"><is><t>email</t></is></c></row>
    <row r="3"><c r="A3" s="1"><v>45689</v></c><c r="C3" t="inlineStr"><is><t>chat</t></is></c></row>
    <row r="4"/>
    <row r="5"><c r="A5" t="b"><v>1</v></c><c r="B5" t="b"><v>0</v></c><c r="C5" t="e"><v>#DIV/0!</v></c></row>
  </sheetData></worksheet>`;

  const lines = sheetXmlToLines(sheet, shared, dateStyleFlagsFromXml(styles));
  eq(lines[0], "Month\tTickets\tChannel", "header row from shared strings");
  eq(lines[1], "2025-01-01\t4120\temail", "date style converts, plain number does not");
  eq(lines[2], "2025-02-01\t\tchat", "a gap in B keeps chat in the third column");
  eq(lines[3], "TRUE\tFALSE\t#DIV/0!", "booleans and error values render");
  eq(lines.length, 4, "the empty row is dropped");

  const text = xlsxTextFromParts({
    sharedStrings: `<sst><si><t>Month</t></si><si><t>Tickets</t></si><si><t>Channel</t></si></sst>`,
    styles,
    sheets: [
      { name: "Volumes", xml: sheet },
      { name: "Empty", xml: "<worksheet><sheetData/></worksheet>" },
    ],
  });
  assert.ok(text.startsWith("# Sheet: Volumes"), "sheet name labels the block");
  assert.ok(!text.includes("Empty"), "a sheet with no values contributes no block");
  assert.ok(text.includes("2025-01-01\t4120\temail"), "rows survive the full assembly");
  checks += 3;
}

eq(xlsxTextFromParts({ sheets: [] }), "", "no sheets yields empty text");
eq(xlsxTextFromParts(undefined), "", "nullish parts yield empty text");

deep(
  sheetNamesFromWorkbook(
    `<workbook><sheets><sheet name="Volumes" sheetId="1" r:id="rId1"/><sheet name="Q3 &amp; Q4" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Target="styles.xml"/></Relationships>`,
  ),
  [
    { name: "Volumes", path: "xl/worksheets/sheet1.xml" },
    { name: "Q3 & Q4", path: "xl/worksheets/sheet2.xml" },
  ],
  "sheet display names map to part paths via rels",
);
deep(sheetNamesFromWorkbook("", ""), [], "missing workbook part yields no sheets");

// ---------------------------------------------------------------- chip summary

eq(attachmentSummary({ text: "x".repeat(320) }), "320 chars", "short attachments show exact chars");
eq(attachmentSummary({ text: "x".repeat(3200) }), "3.2k chars", "long attachments abbreviate");
eq(
  attachmentSummary({ text: "x".repeat(20000), truncated: true }),
  "20.0k chars · trimmed",
  "truncation is disclosed on the chip",
);
eq(attachmentSummary(undefined), "0 chars", "nullish attachment does not throw");

console.log(`test-prep-context-files.mjs: ok (${checks} checks)`);
