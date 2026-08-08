#!/usr/bin/env node
/**
 * Post-call contact → account CRM lookup (contact-first, domain fallback).
 * Run: node web/scripts/test-postcall-contact-resolve.mjs
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

import { initDomainStore, getStore } from "../domain/store.js";
import {
  resolveContactsForEmails,
  resolveHistoryMatchesForIntake,
} from "../postcall-contact-resolve.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function seedStores() {
  initDomainStore(null);
  const store = getStore();
  if (store.clearAll) store.clearAll();
  const ts = Date.now();

  await store.createAccount({
    id: "acc_contact",
    name: "Contact Co",
    slug: "contact-co",
    domain: "contactco.io",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.createAccount({
    id: "acc_domain_only",
    name: "Domain Only Inc",
    slug: "domain-only",
    domain: "contactco.io",
    createdAt: ts - 1,
    updatedAt: ts - 1,
  });
  await store.createAccount({
    id: "acc_gmail_domain",
    name: "Should Not Match Gmail",
    slug: "gmail-spam",
    domain: "gmail.com",
    createdAt: ts,
    updatedAt: ts,
  });

  await store.createContact({
    id: "ct_alex",
    accountId: "acc_contact",
    email: "alex@contactco.io",
    name: "Alex",
    createdAt: ts,
    updatedAt: ts,
  });

  await store.createDeal({
    id: "deal_contact",
    accountId: "acc_contact",
    ownerId: "usr_test",
    teamId: "team_test",
    orgId: "org_test",
    title: "Contact Co New Biz",
    type: "new_business",
    stage: "discovery",
    status: "open",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  return store;
}

async function testContactFirstSkipsExtraDomainAccounts() {
  const result = await resolveContactsForEmails(["alex@contactco.io"]);
  const entry = result.byEmail[0];
  assert(entry?.contact?.id === "ct_alex", "exact email resolves contact");
  assert(entry.accounts.length === 1, "contact-linked account only");
  assert(entry.accounts[0].id === "acc_contact", "contact account wins over domain-only peer");
  assert(
    !entry.accounts.some((a) => a.id === "acc_domain_only"),
    "domain fallback skipped when contact exists",
  );
  assert(entry.deals.some((d) => d.id === "deal_contact"), "deals from contact account surfaced");
}

async function testDomainFallbackWhenNoContact() {
  const result = await resolveContactsForEmails(["newhire@contactco.io"]);
  const entry = result.byEmail[0];
  assert(!entry.contact, "no contact for unknown address");
  assert(entry.accounts.length >= 1, "corporate domain finds accounts");
  assert(
    entry.accounts.some((a) => a.id === "acc_contact") ||
      entry.accounts.some((a) => a.id === "acc_domain_only"),
    "domain match returns account with matching domain field",
  );
}

async function testFreeMailSkipsDomainLookup() {
  const result = await resolveContactsForEmails(["person@gmail.com"]);
  const entry = result.byEmail[0];
  assert(!entry.matched, "gmail address does not domain-match CRM accounts");
  assert(entry.accounts.length === 0, "no accounts for consumer email");
}

async function testHistoryDealSurfacedForIntake() {
  const session = {
    email: "se@test.com",
    userId: "usr_test",
    teamId: "team_test",
    orgId: "org_test",
  };
  mem.set(
    "se-singha-history:se@test.com",
    JSON.stringify([
      {
        id: "call_gamersheek",
        timestamp: Date.now(),
        title: "Gamersheek - Discovery",
        prospectEmails: ["sean@gamersheek.co.uk"],
      },
    ]),
  );

  const hist = resolveHistoryMatchesForIntake(
    session,
    ["sean@gamersheek.co.uk"],
    "Gamersheek",
  );
  assert(hist.deals.some((d) => d.id === "deal_hist_gamersheek"), "history deal surfaced");
  assert(hist.accounts.some((a) => a.id === "hist_gamersheek"), "history account surfaced");
}

async function main() {
  await seedStores();
  await testContactFirstSkipsExtraDomainAccounts();
  await testDomainFallbackWhenNoContact();
  await testFreeMailSkipsDomainLookup();
  await testHistoryDealSurfacedForIntake();
  console.log("test-postcall-contact-resolve.mjs: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
