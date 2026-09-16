#!/usr/bin/env node
/**
 * Naming conventions — deal titles + call titles (Task F).
 * Run: node web/scripts/test-naming-conventions.mjs
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

import { initDomainStore, getStore } from "../domain/store.js";
import {
  nextDealTitle,
  ensureDealTitle,
  getOrCreateNewBusinessDeal,
  isLegacyDealTitle,
  formatDealTitlePreview,
} from "../domain/deal-service.js";
import {
  callTitleFor,
  resolveCallTitleFromRecord,
  isLegacyCallTitle,
  productDiscussedFromContext,
  aiShortFormFromAnalysis,
  companyFromCallTitle,
  callTypeLabel,
  activityTypeLabel,
} from "../call-type-labels.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testDealNaming() {
  initDomainStore(null);
  const store = getStore();
  if (store.clearAll) store.clearAll();

  const accountId = "acc_naming";
  const ts = Date.UTC(2026, 7, 1, 12, 0, 0);
  await store.createAccount({
    id: accountId,
    name: "Acme",
    slug: "acme",
    createdAt: ts,
    updatedAt: ts,
  });

  assert(isLegacyDealTitle("New business", "Acme"), "New business is legacy");
  assert(isLegacyDealTitle("Acme - Deal 1 - 2026-08-01", "Acme"), "Deal N scheme is legacy");
  assert(isLegacyDealTitle("Acme — New Business", "Acme"), "em dash NB preview is legacy");
  assert(!isLegacyDealTitle("Acme - New Business - 2026-08-01", "Acme"), "dated NB is canonical");

  const preview = formatDealTitlePreview("Acme", "new_business", ts);
  assert(preview === "Acme - New Business - 2026-08-01", `preview: ${preview}`);

  const nb = await getOrCreateNewBusinessDeal(accountId, "usr_se", "team_1", "org_1");
  assert(nb.title.startsWith("Acme - New Business - "), `NB deal title: ${nb.title}`);

  const legacy = await store.createDeal({
    id: "deal_legacy",
    accountId,
    type: "expansion",
    stage: "research",
    status: "active",
    ownerId: "usr_se",
    teamId: "team_1",
    orgId: "org_1",
    title: "Expansion",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
  const upgraded = await ensureDealTitle(legacy);
  assert(upgraded.title.startsWith("Acme - Expansion - "), `lazy rename: ${upgraded.title}`);

  const title = await nextDealTitle(accountId, { dealType: "expansion", createdAt: ts });
  assert(title === "Acme - Expansion - 2026-08-01", `nextDealTitle expansion: ${title}`);
}

function testCallNaming() {
  assert(isLegacyCallTitle("Discovery with Acme", "Acme"), "with-pattern is legacy");
  assert(!isLegacyCallTitle("Acme · Discovery - Freshdesk", "Acme"), "canonical is not legacy");

  const full = callTitleFor("discovery", "Acme", {
    productDiscussed: "Freshdesk",
    aiShortForm: "Multi-channel routing gaps",
  });
  assert(
    full === "Acme · Discovery - Freshdesk - Multi-channel routing gaps",
    `full call title: ${full}`,
  );

  const partial = callTitleFor("demo", "Northwind Traders");
  assert(partial === "Northwind Traders · Demo", `partial call title: ${partial}`);

  const product = productDiscussedFromContext({
    arrCompute: { product: "freshdesk_omni", productLabel: "Freshdesk Omni" },
  });
  assert(product === "Freshdesk Omni", `product from arr: ${product}`);

  const headline = aiShortFormFromAnalysis({
    callSummary: { headline: "Security review for EU data residency" },
  });
  assert(headline === "Security review for EU data residency", `headline: ${headline}`);

  const legacyRecord = {
    title: "Discovery with Acme",
    callType: "discovery",
    analysis: {
      callHeader: { company: "Acme" },
      callSummary: { headline: "Ticketing workflow deep dive" },
    },
    pass6: { productGaps: [{ productArea: "ticketing_workflow", subArea: "sla_escalation" }] },
  };
  const resolved = resolveCallTitleFromRecord(legacyRecord);
  assert(resolved.includes("Acme · Discovery"), `legacy upgrade: ${resolved}`);
  assert(resolved.includes("Ticketing workflow"), `legacy upgrade product: ${resolved}`);

  assert(companyFromCallTitle("Acme · Discovery - Freshdesk") === "Acme", "company parse");

  assert(callTypeLabel("") === "Activity", "empty type label is Activity");
  assert(activityTypeLabel("demo") === "Demo", "activityTypeLabel alias");
}

async function main() {
  await testDealNaming();
  testCallNaming();
  console.log("test-naming-conventions.mjs: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
