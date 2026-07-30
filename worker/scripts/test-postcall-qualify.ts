/**
 * Unit tests for Pass 4 qualify normalize helpers (no LLM).
 */
import { normalizeQualificationOutput } from "../src/postcall/qualify.ts";
import { MEDDPICC_FIELD_KEYS } from "../src/domain-model/meddpicc.ts";

const checks: [string, boolean][] = [];

const qualification = normalizeQualificationOutput({
  metrics: { value: "Reduce handle time 20%", evidence: "We need 20% faster handling", surfaced: true },
  champion: { value: "", evidence: "not surfaced", surfaced: false },
  economicBuyer: {
    value: "CFO signs off",
    evidence: "Our CFO approves anything over 50k",
    surfaced: true,
  },
});

checks.push(
  ["all eight keys present", MEDDPICC_FIELD_KEYS.every((k) => qualification[k] != null)],
  ["surfaced metrics kept", qualification.metrics.surfaced && qualification.metrics.value.includes("20%")],
  ["not surfaced champion", !qualification.champion.surfaced && qualification.champion.evidence === "not surfaced"],
  ["unsurfaced slots empty value", MEDDPICC_FIELD_KEYS.filter((k) => !qualification[k].surfaced).every((k) => !qualification[k].value)],
  ["economic buyer evidence", qualification.economicBuyer.evidence.includes("CFO")],
);

const weakChampion = normalizeQualificationOutput({
  champion: {
    value: "Alex seemed excited",
    evidence: "",
    surfaced: true,
  },
});

checks.push(
  ["missing evidence on weak champion downgraded", !weakChampion.champion.surfaced],
);

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
console.log(`\n${checks.length} postcall-qualify checks passed.`);
