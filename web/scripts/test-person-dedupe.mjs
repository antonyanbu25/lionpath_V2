import { dedupePersonLabels, normalizePersonKey, preferPersonLabel } from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(normalizePersonKey("Chioma") === normalizePersonKey("chioma@sendova.co.uk"), "name/email share merge key");
assert(preferPersonLabel("Chioma", "chioma@sendova.co.uk") === "Chioma", "prefer spoken name over email");

const merged = dedupePersonLabels([
  "Sathish Kuttan",
  "Pradeepsolai S",
  "Israel",
  "Chioma",
  "chioma@sendova.co.uk",
  "CHIOMA",
]);
assert(merged.length === 4, `expected 4 identities, got ${merged.length}: ${merged.join(" | ")}`);
assert(merged.includes("Chioma"), "merged label is human-readable");
assert(!merged.includes("chioma@sendova.co.uk"), "email variant dropped after merge");
assert(
  dedupePersonLabels(["chioma@sendova.co.uk", "Chioma"])[0] === "Chioma",
  "prefer name even when email listed first",
);

console.log("test-person-dedupe.mjs: all passed");
