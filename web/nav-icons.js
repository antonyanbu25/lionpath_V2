/** Lucide-style nav icons matching newportalui.html IC map. */

const IC = {
  dashboard: [
    ["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1 }],
    ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1 }],
  ],
  brief: [
    ["path", { d: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" }],
    ["path", { d: "M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" }],
  ],
  analysis: [
    ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }],
    ["path", { d: "m7 14 3-3 3 3 5-5" }],
  ],
  history: [
    ["path", { d: "M3 12a9 9 0 1 0 3-6.7L3 8" }],
    ["path", { d: "M3 3v5h5" }],
    ["path", { d: "M12 7v5l4 2" }],
  ],
  building: [
    ["rect", { x: 4, y: 2, width: 16, height: 20, rx: 2 }],
    ["path", { d: "M9 22v-4h6v4" }],
    ["path", { d: "M9 6h.01" }],
    ["path", { d: "M15 6h.01" }],
    ["path", { d: "M9 10h.01" }],
    ["path", { d: "M15 10h.01" }],
    ["path", { d: "M9 14h.01" }],
    ["path", { d: "M15 14h.01" }],
  ],
  deal: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" }],
    ["path", { d: "M12 18V6" }],
  ],
  contacts: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
  coaching: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["circle", { cx: 12, cy: 12, r: 6 }],
    ["circle", { cx: 12, cy: 12, r: 2 }],
  ],
  settings: [
    [
      "path",
      {
        d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      },
    ],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
};

function attrsToString(attrs) {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
}

/**
 * @param {string} name
 * @param {number} [size]
 */
export function navIcon(name, size = 18) {
  const shapes = IC[name] || [];
  const inner = shapes
    .map(([tag, attrs]) => `<${tag} ${attrsToString(attrs)}/>`)
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Fill [data-nav-icon] slots in the sidebar. */
export function initNavIcons() {
  document.querySelectorAll("[data-nav-icon]").forEach((el) => {
    const name = el.getAttribute("data-nav-icon");
    if (!name) return;
    el.innerHTML = navIcon(name, 18);
  });
}
