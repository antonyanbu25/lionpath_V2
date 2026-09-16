/**
 * Force dummy-auth mode for a Playwright page.
 *
 * WHY THIS EXISTS
 *
 * The e2e specs sign in by writing a session into localStorage/sessionStorage
 * and reloading. That only works in dummy-auth mode, which the app selects by
 * whether one gitignored file is importable:
 *
 *   firebase-config.js loadFirebaseConfig()
 *     await import("./firebase-config.local.js")   // present -> real Firebase
 *     catch { /* missing -> dummy login mode on localhost }
 *
 * So on a developer machine that HAS firebase-config.local.js, real Firebase
 * auth boots, resolves to "no signed-in user" about 700ms in, and logs the
 * injected session straight back out. Measured timeline of #app-shell's
 * `hidden` attribute:
 *
 *   t=0ms    hidden       (pre-boot)
 *   t=171ms  NOT hidden   (injected session accepted)
 *   t=701ms  hidden       (real auth resolves signed-out, session discarded)
 *
 * That ~530ms window is why the failure was so confusing: a
 * `waitForSelector("#app-shell:not([hidden])")` lands INSIDE the window and
 * passes, and the very next `page.click(".nav-item[...]")` runs after it has
 * closed and fails with "element is not visible" — pointing at the nav item,
 * which is not the broken thing. Thirteen specs failed this way.
 *
 * It is NOT J-015. The audit attributed these failures to
 * `waitUntil: "networkidle"` never settling because of the looping
 * `<video>` in web/index.html:90, and prescribed converting 16 specs to
 * explicit element waits (P-D1). That diagnosis does not hold: six of the 13
 * failing specs never call `networkidle` at all, and
 * test-postcall-intake-invariants.mjs — the audit's own worked example, which
 * deliberately avoids `networkidle` — was among the failures. P-D1's
 * acceptance criterion ("all 16 pass locally with web/firebase-config.local.js
 * PRESENT") is backwards: present is the condition that breaks them.
 *
 * WHY ROUTE INTERCEPTION RATHER THAN MOVING THE FILE
 *
 * The obvious workaround is to move firebase-config.local.js aside for the e2e
 * batch. Rejected: it mutates a developer's untracked credentials file, and a
 * crash or Ctrl-C between move and restore leaves their local Firebase broken
 * with no clue why. Aborting the request is per-page, needs no cleanup, and
 * cannot outlive the browser.
 *
 * Call this BEFORE page.goto().
 */

/** Matches the specifier loadFirebaseConfig() imports, on any host/port. */
const LOCAL_CONFIG_GLOB = "**/firebase-config.local.js";

/**
 * Make `import("./firebase-config.local.js")` reject, so the app takes the
 * dummy-auth branch regardless of whether the file exists on this machine.
 *
 * Deterministic either way: with the file absent the request 404s and the
 * import rejects; with it present this abort makes the import reject too. The
 * spec no longer depends on local filesystem state.
 */
export async function forceDummyAuth(page) {
  await page.route(LOCAL_CONFIG_GLOB, (route) => route.abort());
}

/**
 * Sign in as `session` and wait for the shell to be genuinely settled.
 *
 * Waits for #app-shell to be un-hidden AND STILL un-hidden a moment later,
 * because the failure mode above is a shell that un-hides and then re-hides.
 * A single waitForSelector cannot distinguish "booted" from "about to be
 * logged out", which is exactly how 13 specs failed while appearing to get
 * past their own boot assertion.
 *
 * Assumes forceDummyAuth(page) has already been called.
 */
export async function signInAsDummy(page, session, { base, timeout = 30000 } = {}) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout });
  await page.evaluate((s) => {
    localStorage.setItem("se-sp-session-local", JSON.stringify(s));
    sessionStorage.setItem("se-sp-session", JSON.stringify(s));
  }, session);
  await page.reload({ waitUntil: "domcontentloaded", timeout });
  await page.waitForSelector("#app-shell:not([hidden])", { timeout });
  await page.waitForSelector("#app-loading", { state: "hidden", timeout }).catch(() => {});
  // Settle check: re-assert after a beat. If real auth were still going to
  // discard the session, it happens within ~700ms of boot.
  await page.waitForTimeout(900);
  const stillIn = await page.evaluate(
    () => !document.getElementById("app-shell")?.hasAttribute("hidden"),
  );
  if (!stillIn) {
    throw new Error(
      "app-shell was un-hidden and then re-hidden — the injected session was discarded. " +
        "forceDummyAuth(page) must be called BEFORE page.goto(), or the app is not in dummy-auth mode.",
    );
  }
}
