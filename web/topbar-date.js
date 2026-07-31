/** Update the main topbar day + date labels. */

/**
 * @param {Date} [now]
 * @param {string|undefined} [locale]
 */
export function updateTopbarDate(now = new Date(), locale) {
  const dateEl = document.getElementById("topbar-date-text");
  const loc = locale || undefined;
  const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  if (dateEl) dateEl.textContent = now.toLocaleDateString(loc, opts);
}
