/**
 * Scroll-triggered graph animations for the v9 pre-call brief.
 * One shared IntersectionObserver; elements animate once when scrolled into view.
 * Respects prefers-reduced-motion — final state shown immediately with no observer.
 */

/** @type {IntersectionObserver | null} */
let sharedObserver = null;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function ensureObserver() {
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("prep-v9-inview");
        sharedObserver?.unobserve(entry.target);
      }
    },
    { root: null, rootMargin: "0px 0px -6% 0px", threshold: 0.14 },
  );
  return sharedObserver;
}

/**
 * Wire one-shot scroll animations for graph/chart blocks inside a brief tab.
 * Safe to call after every tab re-render — already-animated nodes are skipped.
 * @param {ParentNode | null | undefined} root
 */
export function wirePrepV9ScrollAnimations(root) {
  if (!root) return;

  const targets = root.querySelectorAll("[data-prep-v9-animate]");
  if (!targets.length) return;

  if (prefersReducedMotion()) {
    targets.forEach((el) => el.classList.add("prep-v9-inview"));
    return;
  }

  const observer = ensureObserver();
  targets.forEach((el) => {
    if (el.classList.contains("prep-v9-inview")) return;
    observer.observe(el);
  });
}
