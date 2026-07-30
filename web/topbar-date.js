/** Update the main topbar day + date labels. */

/**
 * @param {Date} [now]
 * @param {string|undefined} [locale]
 */
export function updateTopbarDate(now = new Date(), locale) {
  const dayEl = document.getElementById("topbar-day");
  const dateEl = document.getElementById("topbar-date-text");
  const loc = locale || undefined;
  const dayOpts = { weekday: "long" };
  const dateOpts = { day: "numeric", month: "long", year: "numeric" };
  if (dayEl) dayEl.textContent = now.toLocaleDateString(loc, dayOpts);
  if (dateEl) dateEl.textContent = now.toLocaleDateString(loc, dateOpts);
}
