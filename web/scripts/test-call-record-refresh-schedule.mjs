/**
 * Simulates call-record panel refresh scheduling during post-call hydration.
 * Validates that incremental section updates coalesce instead of forcing 3 full renders.
 */
import assert from "node:assert/strict";

function simulateHydrationRefreshSequence({ coalesceSectionUpdates }) {
  let renderCount = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let targetId = null;

  const schedule = (id, { immediate = false, sections = [] } = {}, pending) => {
    if (!immediate && sections.length > 0) {
      const blocked = sections.some((key) => pending.includes(key));
      if (blocked) {
        targetId = id;
        return;
      }
      if (coalesceSectionUpdates) {
        if (pending.length > 0) {
          targetId = id;
          return;
        }
      } else {
        immediate = true;
      }
    } else if (!immediate && pending.length > 0) {
      targetId = id;
      return;
    }
    targetId = id;
    clearTimeout(timer);
    if (immediate) {
      targetId = null;
      renderCount += 1;
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (targetId === id) {
        targetId = null;
        renderCount += 1;
      }
    }, 900);
  };

  const callId = "call-1";

  // 1) navigateToCallRecord → openCallRecord → switchView (immediate)
  schedule(callId, { immediate: true }, ["qualify", "summarise", "commit", "arr", "gaps"]);

  // 2) summarise completes — other hydration keys still pending
  schedule(callId, { sections: ["summarise"] }, ["commit", "arr", "gaps"]);

  // 3) hydration complete — pending empty
  schedule(callId, { immediate: true }, []);

  return renderCount;
}

const legacyRenders = simulateHydrationRefreshSequence({ coalesceSectionUpdates: false });
const fixedRenders = simulateHydrationRefreshSequence({ coalesceSectionUpdates: true });

assert.equal(legacyRenders, 3, `expected 3 legacy renders, got ${legacyRenders}`);
assert.equal(fixedRenders, 2, `expected 2 coalesced renders, got ${fixedRenders}`);

console.log("test-call-record-refresh-schedule: ok");
