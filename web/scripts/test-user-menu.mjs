/** Smoke tests for user menu markup and sidebar collapse placement. */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(WEB_ROOT, "index.html"), "utf8");

const collapseInHead = /<div class="sidebar-head">[\s\S]*?id="sidebar-collapse"[\s\S]*?<\/div>\s*<nav class="sidebar-nav"/.test(html);
const userInFoot = /<div class="sidebar-foot">[\s\S]*?id="sidebar-user"[\s\S]*?<\/div>\s*<\/div>\s*<\/aside>/.test(html);

const checks = [
  ["user menu container", html.includes('id="user-menu"')],
  ["user menu panel in sidebar", html.includes('user-menu-panel--sidebar')],
  ["sidebar user trigger", html.includes('id="sidebar-user"')],
  ["no topbar user menu trigger visible", !html.includes('class="user-menu-trigger"') || html.includes('user-menu-trigger" hidden')],
  ["profile settings menu item", html.includes('id="user-menu-profile"')],
  ["theme submenu", html.includes('id="user-menu-theme-submenu"')],
  ["sign out in menu", html.includes('id="user-menu-signout"')],
  ["profile view panel", html.includes('id="view-profile"')],
  ["collapse inside sidebar-head", collapseInHead],
  ["sidebar user in footer", userInFoot],
  ["topbar new brief button", html.includes('id="topbar-new-brief"')],
  ["topbar new call button", html.includes('id="topbar-new-call"')],
  ["topbar notifications button", html.includes('id="topbar-notifications"')],
  ["user menu backdrop", html.includes('id="user-menu-backdrop"')],
  ["prep crm matches panel", html.includes('id="prep-crm-matches"')],
  ["sidebar nav divider", html.includes('class="sidebar-nav-divider"')],
  ["dashboard nav item", html.includes('data-view="dashboard"')],
  ["no dashboard overview tabs", !html.includes('id="dash-tabs"')],
  ["dashboard panel mount", html.includes('id="dash-panel"')],
  ["coaching view panel", html.includes('id="view-coaching"')],
  ["settings nav item", html.includes('data-view="profile"')],
  ["Pre-call brief label", html.includes("Pre-call brief")],
  ["My deals nav label", html.includes("My deals")],
  ["My contacts nav", html.includes('data-view="contacts"')],
  ["My coaching nav", html.includes('data-view="coaching"')],
  ["SE Labs brand", html.includes("SE Labs")],
  ["no capture nav group", !html.includes('<div class="nav-grp">Capture</div>')],
  ["no sidebar recent work", !html.includes('class="sidebar-recent-work"')],
  ["no sidebar logout btn", !html.includes('id="logout-btn"')],
  ["no app topbar theme toggle", !html.includes('class="main-topbar"') || !/main-topbar[\s\S]*data-theme-toggle/.test(html)],
  ["login theme toggle removed", !html.includes('login-card-head') || !/login-card-head[\s\S]*data-theme-toggle/.test(html)],
  ["login video background", html.includes('class="login-bg-video"') && html.includes("assets/login-bg.webm")],
  ["Freshworks sidebar logo", html.includes('class="sidebar-brand-logo"') && html.includes("assets/freshworks-logomark.webp")],
  ["Freshworks login logo", html.includes('class="login-brand-logo"') && html.includes("assets/freshworks-logomark.webp")],
  ["dashboard nav svg icon", /data-view="dashboard"[\s\S]*?data-nav-icon="dashboard"/.test(html)],
  ["settings nav svg icon", /data-view="profile"[\s\S]*?data-nav-icon="settings"/.test(html)],
  ["precall nav brief icon", /data-view="precall"[\s\S]*?data-nav-icon="brief"/.test(html)],
  ["dashboard nav no crayons icon", (() => {
    const m = html.match(/<fw-button[^>]*data-view="dashboard"[\s\S]*?<\/fw-button>/);
    return m ? !m[0].includes("fw-icon") : false;
  })()],
  ["sidebar user chevron up", html.includes('class="sidebar-user-chevron"') && html.includes("⌃")],
  ["no sidebar brand sub", !html.includes('class="sidebar-brand-sub"')],
  ["topbar inside main content", /<main class="main-content">[\s\S]*?<header class="main-topbar"/.test(html)],
  ["topbar date label", html.includes('id="topbar-date-text"')],
  ["topbar date block", html.includes('class="topbar-date"')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} user menu checks passed.`);
