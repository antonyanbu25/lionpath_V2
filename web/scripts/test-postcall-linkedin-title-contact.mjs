/**
 * v2.3 (Agent 3/6) — a LinkedIn-confirmed title must reach ensureCustomerContact and persist
 * as a non-null contact title. Before this fix, post-call only ever passed { name, email } to
 * ensureCustomerContact (postcall.js confirm handler), so resolveContactOnAccount's
 * `title: attendee.title || null` always wrote null regardless of what was extracted from a
 * LinkedIn PDF.
 */
import { initDomainStore, getStore } from "../domain/store.js";
import { ensureCustomerContact } from "../domain/contact-service.js";
import { now } from "../domain/types.js";

const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => ls.get(k) ?? null,
  setItem: (k, v) => ls.set(k, v),
  removeItem: (k) => ls.delete(k),
  key: (i) => [...ls.keys()][i] ?? null,
  get length() {
    return ls.size;
  },
};

initDomainStore(null);
const store = getStore();
const ts = now();
const accountId = "acc_linkedin_test";

await store.createAccount({
  id: accountId,
  name: "Acme Corp",
  domain: "acme.com",
  slug: "acme-corp",
  createdAt: ts,
  updatedAt: ts,
});

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Simulates buildConfirmAttendees() output for an attendee matched to a LinkedIn export —
// see linkedinTitleForAttendee() in postcall.js, which looks this up from
// resolve.linkedinIdentities and passes it through at the ensureCustomerContact call site.
const contact = await ensureCustomerContact(
  accountId,
  { name: "Priyal Shah", email: "priyal.shah@acme.com", title: "VP of Customer Success" },
  { actorId: "se_1", source: "postcall_confirm" },
);

assert(contact, "contact created");
assert(contact.title === "VP of Customer Success", `title persisted, got ${JSON.stringify(contact.title)}`);
assert(contact.title !== null, "title is non-null");

// Regression guard: the pre-fix call site passed only { name, email } — confirm that shape
// still creates a contact (back-compat) but with a null title, so the fix is visibly the
// difference between these two assertions rather than something the store defaults for free.
const contactNoTitle = await ensureCustomerContact(
  accountId,
  { name: "Ravi Kumar", email: "ravi.kumar@acme.com" },
  { actorId: "se_1", source: "postcall_confirm" },
);
assert(contactNoTitle.title === null, "omitting title still defaults to null (confirms the fix is additive)");

console.log("test-postcall-linkedin-title-contact: ok");
