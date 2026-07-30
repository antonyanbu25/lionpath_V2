/**
 * Unit tests for account ARR roll-up and attach matrix (task 2.8).
 */
import {
  ATTACH_MATRIX_ADDON_KEYS,
  buildAttachMatrix,
  classifyAddonAttachCell,
  findCrossSellGaps,
  findDiscussedUnquantifiedAddons,
  summarizeIncludedArr,
} from "../domain/account-arr-service.js";
import { renderAccountArrModule } from "../account-arr-module.js";
import { esc } from "../shared.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(classifyAddonAttachCell({ excluded: false, annualValue: 100, quantity: 5 }) === "attached", "attached");
assert(
  classifyAddonAttachCell({ excluded: true, exclusionReason: "not_quantified", inScope: true }) === "discussed",
  "discussed",
);
assert(classifyAddonAttachCell(null) === "absent", "absent");

const summary = summarizeIncludedArr([
  { kind: "base", excluded: false, annualValue: 9744 },
  { kind: "addon", excluded: false, annualValue: 4872, addonKey: "freddy_ai_copilot" },
]);
assert(summary.totalArr === 14616, "total arr");
assert(summary.baseArr === 9744, "base arr");
assert(summary.addonArr === 4872, "addon arr");
assert(Math.abs(summary.addonShare - 33.3) < 0.2, "addon share");

const deals = [
  { id: "deal_nb", type: "new_business", status: "active", title: "NB", createdAt: 1 },
  { id: "deal_exp", type: "expansion", status: "active", title: "Expansion", createdAt: 2 },
];
const linesByDealId = new Map([
  [
    "deal_nb",
    [
      { kind: "addon", addonKey: "freddy_ai_copilot", excluded: false, annualValue: 4872, quantity: 14 },
      { kind: "addon", addonKey: "freddy_ai_agent_sessions", excluded: true, exclusionReason: "not_quantified", inScope: true, evidence: "we want AI agent" },
    ],
  ],
  ["deal_exp", []],
]);

const matrix = buildAttachMatrix(deals, linesByDealId);
assert(matrix.deals.length === 2, "matrix deals");
assert(matrix.cells.freddy_ai_copilot.deal_nb.state === "attached", "copilot on nb");
assert(matrix.cells.freddy_ai_copilot.deal_exp.state === "absent", "copilot absent exp");

const gaps = findCrossSellGaps(deals, linesByDealId);
assert(gaps.some((g) => g.addonKey === "freddy_ai_copilot"), "cross-sell gap");

const unquant = findDiscussedUnquantifiedAddons(deals, linesByDealId);
assert(unquant.length === 1 && unquant[0].addonKey === "freddy_ai_agent_sessions", "unquantified");

const html = renderAccountArrModule({
  totalArr: 14616,
  totalMrr: 1218,
  baseArr: 9744,
  addonArr: 4872,
  baseMrr: 812,
  addonMrr: 406,
  addonShare: 33.3,
  attachMatrix: matrix,
  crossSellGaps: gaps,
  discussedUnquantified: unquant,
  allowanceConsumerDealId: "deal_nb",
  estimateBand: { low: 14000, high: 15000, point: 14500 },
});
assert(html.includes("Add-on attach matrix"), "matrix title");
assert(html.includes("Cross-sell gaps"), "cross sell block");
assert(html.includes("Discussed, never quantified"), "unquant block");
assert(html.includes("500-session account allowance"), "allowance note");
assert(!html.includes(esc("<script>")), "escaped");

assert(ATTACH_MATRIX_ADDON_KEYS.includes("freddy_ai_copilot"), "copilot key");

console.log("test-account-arr-module: ok");
