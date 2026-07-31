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
  ["user menu trigger", html.includes('id="user-menu-trigger"')],
  ["profile settings menu item", html.includes('id="user-menu-profile"')],
  ["theme submenu", html.includes('id="user-menu-theme-submenu"')],
  ["sign out in menu", html.includes('id="user-menu-signout"')],
  ["profile view panel", html.includes('id="view-profile"')],
  ["collapse inside sidebar-head", collapseInHead],
  ["sidebar user in footer", userInFoot],
  ["sidebar user block", html.includes('id="sidebar-user-name"')],
  ["sidebar nav divider", html.includes('class="sidebar-nav-divider"')],
  ["dashboard nav item", html.includes('data-view="dashboard"')],
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
  ["login theme toggle kept", html.includes('login-card-head') && html.includes('data-theme-toggle')],
  ["topbar day label", html.includes('id="topbar-day"')],
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
