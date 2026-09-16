/** Deal ↔ call product signal rollup — store + history merge. */
import {
  mergeDealProductSignalExtras,
  resolveDealProductSignals,
  rollupProductSignalRows,
} from "../domain/product-signal-service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeExtras = { productGaps: [], whatWorks: [] };
const historyExtras = {
  productGaps: [
    { verbatim: "Need API access", postCallId: "c1", dealId: "d1", createdAt: 100 },
    { verbatim: "Copilot demo landed", postCallId: "c2", dealId: "d1", createdAt: 200 },
  ],
  whatWorks: [{ verbatim: "Setup looks simple", postCallId: "c2", createdAt: 210 }],
};

const merged = mergeDealProductSignalExtras(storeExtras, historyExtras);
assert(merged.productGaps.length === 2, "history gaps on deal when store empty");
assert(merged.whatWorks.length === 1, "history wins on deal when store empty");

const callView = await resolveDealProductSignals(
  { listProductGapsByDeal: async () => [], listWhatWorksByDeal: async () => [] },
  "d1",
  {
    currentCallId: "c2",
    callGaps: historyExtras.productGaps.filter((g) => g.postCallId === "c2"),
    callWorks: historyExtras.whatWorks,
    historyRecords: [
      { id: "c1", timestamp: 100, dealId: "d1", pass6: { productGaps: [historyExtras.productGaps[0]], whatWorks: [] } },
      {
        id: "c2",
        timestamp: 200,
        dealId: "d1",
        pass6: { productGaps: [historyExtras.productGaps[1]], whatWorks: historyExtras.whatWorks },
      },
    ],
  },
);
assert(callView.productGaps.length === 2, "call view deal rollup");
assert(
  callView.productGaps.filter((g) => g.surfacedOnThisCall).length === 1,
  "one signal surfaced on call c2",
);

const deduped = rollupProductSignalRows(
  [
    { verbatim: "Same gap", postCallId: "c1", createdAt: 1 },
    { verbatim: "Same gap", postCallId: "c2", createdAt: 2 },
  ],
  "c2",
);
assert(deduped.length === 1, "dedupe repeated verbatim");
assert(deduped[0].firstSurfacedCallId === "c1", "first call owns surface");

console.log("test-deal-product-signal-rollup: ok");
