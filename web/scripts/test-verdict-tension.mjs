/** Unit tests — buildVerdictTension uses v2.1 /10 QIP thresholds, not legacy /100. */
import { buildVerdictTension } from "../call-view.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  qipScore: null,
  qipDelta: null,
  meddpiccScore: null,
  momentumStatus: null,
  confidencePct: null,
};

// /10 QIP delta bands (legacy /100 used 8 and 3)
assert(
  buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: 0.9 }).includes("Strong call execution"),
  "qipDelta >= 0.8 → strong call execution",
);
assert(
  buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: -0.9 }).includes("Execution below your usual bar"),
  "qipDelta <= -0.8 → execution below your usual bar",
);
assert(
  buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: 0.4 }).includes("Solid execution"),
  "qipDelta >= 0.3 → solid execution",
);
assert(
  buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: -0.4 }).includes("Execution lagging your norm"),
  "qipDelta <= -0.3 → execution lagging your norm",
);

// /10 QIP score thresholds (legacy /100 used 75 and 55)
assert(
  buildVerdictTension({ ...base, qipScore: 7.6, meddpiccScore: 72 }).includes(
    "Deal qualification keeps pace with delivery",
  ),
  "qipScore >= 7.5 + meddpicc >= 70 → keeps pace",
);
assert(
  buildVerdictTension({ ...base, qipScore: 7.6, meddpiccScore: 40 }).includes(
    "The gap is qualification, not delivery",
  ),
  "qipScore >= 7.5 + meddpicc < 45 → gap is qualification",
);
assert(
  buildVerdictTension({ ...base, qipScore: 5.0, meddpiccScore: 65 }).includes(
    "The deal looks real but this call did not land",
  ),
  "qipScore < 5.5 + meddpicc >= 60 → call did not land",
);

// Lead sentence thresholds
assert(
  buildVerdictTension({ ...base, qipScore: 8.0, meddpiccScore: 35, momentumStatus: "Advancing" }).startsWith(
    "Flawless call on a thin deal.",
  ),
  "lead: flawless call on thin deal when qip >= 7.5 and meddpicc < 45",
);
assert(
  buildVerdictTension({ ...base, qipScore: 4.5, meddpiccScore: 65, momentumStatus: "At risk" }).startsWith(
    "Qualified deal, weak call.",
  ),
  "lead: qualified deal weak call when qip < 5.5 and meddpicc >= 60",
);

// Threshold boundaries
assert(
  !buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: 0.79 }).includes("Strong call execution"),
  "qipDelta 0.79 must not hit strong execution band (needs >= 0.8)",
);
assert(
  buildVerdictTension({ ...base, qipScore: 7.8, qipDelta: 0.8 }).includes("Strong call execution"),
  "qipDelta 0.8 hits strong execution band",
);
assert(
  !buildVerdictTension({ ...base, qipScore: 7.4, meddpiccScore: 72 }).includes(
    "Deal qualification keeps pace with delivery",
  ),
  "qipScore 7.4 must not trigger >= 7.5 band",
);

assert(
  buildVerdictTension(base) ===
    "Scores tell different stories. Use the scorecard evidence before coaching or forecasting.",
  "empty inputs → fallback copy",
);

console.log("test-verdict-tension: ok");
