// Locks the "New pre-call brief" form to the approved portal design (newportalui.html).
// Values below are the design spec — update only when the design itself changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Strip CSS comments before parsing. rule() captures a block with `\{([^}]*)\}`, so a `}`
 * anywhere inside an explanatory comment truncates the captured body and every declaration
 * after it reads as missing. precall.css has exactly that — a comment citing
 * `label { flex-direction: column }` inside .nb-label — which made a complete rule report
 * `missing "font-size"`.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const css = stripComments(readFileSync(join(webDir, "precall.css"), "utf8"));
const html = readFileSync(join(webDir, "index.html"), "utf8");
const theme = stripComments(readFileSync(join(webDir, "dew-theme.css"), "utf8"));

/** Grab the body of the first rule whose selector matches exactly. */
function rule(source, selector) {
  const re = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const m = source.match(re);
  assert.ok(m, `missing CSS rule: ${selector}`);
  return m[1];
}

function decl(source, selector, prop) {
  const body = rule(source, selector);
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "m"));
  assert.ok(m, `${selector} missing "${prop}"`);
  return m[1].trim();
}

function expectDecls(selector, expected, source = css) {
  for (const [prop, value] of Object.entries(expected)) {
    assert.equal(decl(source, selector, prop), value, `${selector} { ${prop} }`);
  }
}

// --- Design tokens must equal the design's literal hex values -----------------
const lightTokens = theme.slice(theme.indexOf(":root"), theme.indexOf("}", theme.indexOf(":root")));
for (const [token, value] of Object.entries({
  "--dew-primary": "#6fb8ac",
  "--dew-primary-hover": "#5da79a",
  "--dew-brand": "#2e897b",
  "--dew-brand-tint": "#e3efec",
  "--dew-text": "#2b2926",
  "--dew-text-muted": "#8a8072",
  "--dew-surface": "#ffffff",
  "--dew-surface-subtle": "#faf8f4",
  "--dew-border": "#ece7de",
  "--dew-hairline": "#f4f0e8",
  "--dew-red": "#b8544a",
})) {
  const m = lightTokens.match(new RegExp(`${token}\\s*:\\s*([^;]+)`));
  assert.ok(m, `dew-theme.css light block missing ${token}`);
  assert.equal(m[1].trim(), value, `token ${token}`);
}

// --- Shell: centered 720px column -------------------------------------------
expectDecls(".prep-form-center", { "max-width": "720px", margin: "6px auto 0" });

// Heading is precall-scoped so post-call keeps its own size and subtitle.
assert.ok(
  !/\.prep-form-heading p:not\(\.nb-build-stamp\)/.test(css),
  "hiding .prep-form-heading p globally also hides the post-call subtitle",
);
assert.ok(
  /\.nb-form-heading p:not\(\.nb-build-stamp\)\s*\{\s*display:\s*none/.test(css),
  "precall subtitle hide must be scoped to .nb-form-heading",
);

// --- Card --------------------------------------------------------------------
expectDecls(".nb-form-card", {
  "border-radius": "16px",
  padding: "24px",
  "box-shadow": "0 1px 3px rgba(43, 41, 38, 0.05)",
});
expectDecls(".nb-form", { gap: "18px" });

// --- Labels, hints, inputs ---------------------------------------------------
expectDecls(".nb-label", { "font-size": "12.5px", "font-weight": "700", "margin-bottom": "7px", gap: "5px" });
expectDecls(".nb-label-tight", { "margin-bottom": "2px" });
expectDecls(".nb-hint", { "font-size": "11.5px", margin: "6px 0 0" });
expectDecls(".nb-hint-tight", { margin: "0 0 9px" });
expectDecls(".nb-input-shell", {
  gap: "9px",
  "border-radius": "11px",
  "min-height": "46px",
  padding: "0 14px",
});

// --- Account + deal tiles ----------------------------------------------------
expectDecls(".nb-account-deal-grid", { "grid-template-columns": "1fr 1fr", gap: "14px" });
expectDecls(".nb-account-card-mono", {
  width: "30px",
  height: "30px",
  "border-radius": "8px",
  "font-size": "11px",
  "font-weight": "800",
});
expectDecls(".nb-deal-head", { "margin-bottom": "7px" });
// Nested label margin would drop the deal tile below the account tile.
expectDecls(".nb-deal-head .nb-label", { "margin-bottom": "0" });
expectDecls(".nb-deal-new-link", { "font-size": "11.5px", "font-weight": "600" });
expectDecls(".nb-deal-card-icon", {
  width: "30px",
  height: "30px",
  "border-radius": "50%",
  background: "#f3ecda",
  color: "#a5883f",
});

// --- LinkedIn rows -----------------------------------------------------------
expectDecls(".nb-linkedin-attendees", { gap: "8px" });
expectDecls(".nb-linkedin-row", { "border-radius": "11px", padding: "9px 12px", gap: "10px" });
expectDecls(".nb-linkedin-upload-btn", { border: "1.5px dashed #cfe3de", background: "#f7fbfa", padding: "5px 10px" });
expectDecls(".nb-linkedin-uploaded", { padding: "5px 9px", "font-size": "11.5px" });

// --- Context section ---------------------------------------------------------
expectDecls(".nb-context-section", { "border-top": "1px solid var(--dew-hairline)", "padding-top": "16px", gap: "9px" });
expectDecls(".nb-context-section fw-textarea::part(textarea)", { "min-height": "92px", "font-size": "13px" });
expectDecls(".nb-attach-btn", { height: "38px", "border-radius": "10px", padding: "0 14px", gap: "8px" });

// --- Generate button ---------------------------------------------------------
expectDecls(".nb-generate-btn", {
  background: "var(--dew-primary)",
  height: "50px",
  "border-radius": "12px",
  "font-size": "15px",
  "font-weight": "700",
  gap: "8px",
});

// --- Recent briefs -----------------------------------------------------------
expectDecls(".nb-recent-briefs", { "margin-top": "22px" });
expectDecls(".nb-recent-label", { "font-size": "11px", "letter-spacing": "0.09em", margin: "0 4px 10px" });
expectDecls(".nb-recent-item", { "border-radius": "12px", padding: "12px 14px", gap: "12px" });
expectDecls(".nb-recent-mono", { width: "34px", height: "34px", "border-radius": "9px" });

// --- Markup contract ---------------------------------------------------------
for (const id of [
  "prospectEmail",
  "prep-account-deal-grid",
  "prep-deal-new-btn",
  "companyDomain",
  "prep-linkedin-attendees",
  "additionalContext",
  "prep-context-add-btn",
  "generate",
  "prep-recent-briefs",
]) {
  assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
}
assert.ok(/<h1>New pre-call brief<\/h1>/.test(html), "heading text changed");

// Cache-bust marker must stay in lockstep with the deploy guards.
const portalBuild = html.match(/portal-build" content="([^"]+)"/)?.[1];
const precallCss = html.match(/precall\.css\?v=([^"]+)"/)?.[1];
assert.ok(portalBuild?.includes("precall-align"), `portal-build must contain precall-align, got ${portalBuild}`);
assert.equal(precallCss, "2.0.8-precall-align3");
assert.ok(portalBuild.startsWith("2.0.7.4-"), `portal-build must be on the 2.0.7.4 train, got ${portalBuild}`);

for (const [file, needle] of [
  ["../deploy/vps/update.sh", `precall.css?v=${precallCss}`],
  ["../deploy/vps/verify-deploy.sh", `precall.css?v=${precallCss}`],
]) {
  const body = readFileSync(join(webDir, file), "utf8");
  assert.ok(body.includes(needle), `${file} must guard on ${needle}`);
}

console.log("test-precall-design-tokens: ok");
