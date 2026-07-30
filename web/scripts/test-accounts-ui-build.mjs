/**
 * Build-time checks for Accounts UI (Option A) — run before manual QA or after changes.
 * Mirrors the plan review checklist; fails fast on regressions.
 */
import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fileExists(rel) {
  try {
    await access(join(WEB_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

async function readWeb(rel) {
  return readFile(join(WEB_ROOT, rel), "utf8");
}

const indexHtml = await readWeb("index.html");
const appJs = await readWeb("app.js");
const stylesCss = await readWeb("styles.css");

// Nav: Accounts present, Lifecycles nav removed
assert(indexHtml.includes('data-view="accounts"'), "index.html: Accounts nav missing");
assert(indexHtml.includes('data-view="deals"'), "index.html: Deals nav missing");
assert(indexHtml.includes('data-view="calls"'), "index.html: Calls nav missing");
assert(indexHtml.includes('id="view-deals"'), "index.html: view-deals section missing");
assert(!indexHtml.includes('data-view="lifecycles"'), "index.html: Lifecycles nav still present");
assert(!indexHtml.includes('id="sidebar-account"'), "index.html: sidebar account card still present");
assert(!indexHtml.includes("sidebar-lifecycle-section"), "index.html: Recent lifecycles section still present");
assert(indexHtml.includes("Discovery briefs"), "index.html: Discovery briefs section missing");
assert(indexHtml.includes('class="sidebar-collapse-glyph"'), "index.html: sidebar collapse glyph missing");
assert(indexHtml.includes("Call reviews"), "index.html: Call reviews section missing");
assert(indexHtml.includes('id="view-accounts"'), "index.html: view-accounts section missing");
assert(indexHtml.includes('id="account-panel"'), "index.html: account-panel missing");
assert(!indexHtml.includes('id="view-lifecycles"'), "index.html: view-lifecycles still present");

assert(indexHtml.includes('id="global-search-input"'), "index.html: global search input missing");
assert(indexHtml.includes('id="global-search-modal"'), "index.html: global search modal missing");

// Styles: sidebar-account chrome removed
assert(!stylesCss.includes(".sidebar-account-context"), "styles.css: sidebar-account styles still present");
assert(stylesCss.includes(".global-search-input"), "styles.css: global search styles missing");

// App routing
assert(appJs.includes('accounts: "Accounts"'), "app.js: VIEW_TITLES accounts missing");
assert(appJs.includes('calls: "All calls"'), "app.js: VIEW_TITLES calls missing");
assert(appJs.includes("renderCallsListView"), "app.js: renderCallsListView missing");
assert(appJs.includes("initGlobalSearch"), "app.js: initGlobalSearch missing");
assert(appJs.includes("invalidateSearchIndex"), "app.js: invalidateSearchIndex missing");
assert(appJs.includes("selectedAccountId"), "app.js: selectedAccountId routing missing");
assert(appJs.includes("renderAccountPanel"), "app.js: renderAccountPanel missing");
assert(appJs.includes('lifecycles: { view: "accounts" }'), "app.js: #lifecycles hash alias missing");
assert(appJs.includes("lifecycleMatch"), "app.js: #lifecycles/{id} redirect missing");
assert(!appJs.includes("account-sidebar.js"), "app.js: still imports account-sidebar.js");
assert(!appJs.includes("refreshAccountSidebarContext"), "app.js: sidebar account wiring still present");

// Files
assert(await fileExists("account-view.js"), "account-view.js missing");
assert(await fileExists("calls-list-view.js"), "calls-list-view.js missing");
assert(!(await fileExists("account-sidebar.js")), "account-sidebar.js should be deleted");
assert(await fileExists("domain/account-service.js"), "account-service.js missing");

const accountService = await readWeb("domain/account-service.js");
assert(accountService.includes("listAccountsForSession"), "account-service: listAccountsForSession missing");
assert(accountService.includes("listAccountsForUser"), "account-service: listAccountsForUser missing");
assert(accountService.includes("updateAccountSeTeam"), "account-service: updateAccountSeTeam missing");
assert(accountService.includes("getAccountEngagementDetail"), "account-service: getAccountEngagementDetail missing");

const accountView = await readWeb("account-view.js");
assert(accountView.includes("All accounts"), "account-view: account-centric copy missing");
assert(!accountView.includes("All lifecycles"), "account-view: lifecycle copy still present");
assert(accountView.includes("account-list-search"), "account-view: list search missing");
assert(accountView.includes("Deal team"), "account-view: deal team card missing");

assert(await fileExists("search-service.js"), "search-service.js missing");
assert(await fileExists("global-search.js"), "global-search.js missing");

// Syntax
const { spawnSync } = await import("node:child_process");
for (const f of ["app.js", "account-view.js", "calls-list-view.js", "domain/account-service.js", "search-service.js", "global-search.js"]) {
  const r = spawnSync(process.execPath, ["--check", join(WEB_ROOT, f)], { stdio: "pipe" });
  assert(r.status === 0, `syntax check failed: ${f}`);
}

console.log("test-accounts-ui-build: ok");
