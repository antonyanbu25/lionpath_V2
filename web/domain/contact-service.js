/**
 * Contact merge, MEDDPICC rollup, and contact-scoped activity events.
 */

import { getStore } from "./store.js";
import { contactScopeFromAccount } from "./account-se-team.js";
import { newId, now } from "./types.js";

export const MEDDPICC_FIELD_KEYS = [
  "metrics",
  "economicBuyer",
  "decisionCriteria",
  "decisionProcess",
  "paperProcess",
  "identifyPain",
  "champion",
  "competition",
];

export const MEDDPICC_FIELD_LABELS = {
  metrics: "Metrics",
  economicBuyer: "Economic buyer",
  decisionCriteria: "Decision criteria",
  decisionProcess: "Decision process",
  paperProcess: "Paper process",
  identifyPain: "Identify pain",
  champion: "Champion",
  competition: "Competition",
};

const STATUS_RANK = { unknown: 0, partial: 1, confirmed: 2 };

/** Dual-read legacy account MEDDPICC until Phase 6 cleanup (ADR 005). */
export const MEDDPICC_ACCOUNT_FALLBACK = true;

/**
 * Merge MEDDPICC signals into a metadata bag (deal or account).
 * @param {object|undefined} existingMeta
 * @param {object} signals
 * @param {"prep"|"postcall"|"manual"|"migration"} source
 */
export function mergeMeddpiccIntoMeta(existingMeta, signals, source) {
  if (!signals || !Object.keys(signals).length) return existingMeta || {};
  const meta = { ...(existingMeta || {}) };
  const current = { ...(meta.meddpicc || {}) };
  const ts = now();

  for (const key of MEDDPICC_FIELD_KEYS) {
    const incoming = signals[key];
    if (!incoming) continue;
    const merged = mergeFieldSlot(current[key], {
      ...incoming,
      source: incoming.source || source,
      updatedAt: incoming.updatedAt || ts,
    });
    if (merged) current[key] = merged;
  }

  current.lastUpdatedAt = ts;
  current.completionScore = computeMeddpiccScore(current);
  meta.meddpicc = current;
  return meta;
}

/** @deprecated Migration only. use mergeDealMeddpicc for writes (ADR 005). */
export function mergeAccountMeddpicc(existingMeta, signals, source) {
  return mergeMeddpiccIntoMeta(existingMeta, signals, source);
}

/**
 * @param {import("./types.js").Deal|null|undefined} deal
 * @param {object} signals
 * @param {"prep"|"postcall"|"manual"|"migration"} source
 * @returns {{ metadata: object }|null}
 */
export function mergeDealMeddpicc(deal, signals, source) {
  if (!deal?.id) return null;
  const metadata = mergeMeddpiccIntoMeta(deal.metadata, signals, source);
  return { metadata };
}

/**
 * Resolve MEDDPICC rollup for UI (deal first, optional account fallback).
 * @param {import("./types.js").Deal|null|undefined} deal
 * @param {import("./types.js").Account|null|undefined} account
 * @returns {import("./types.js").MeddpiccRollup|null}
 */
export function resolveDealMeddpicc(deal, account) {
  const onDeal = deal?.metadata?.meddpicc;
  if (onDeal && Object.keys(onDeal).length > 1) return onDeal;
  const hasDealFields = onDeal && MEDDPICC_FIELD_KEYS.some((k) => onDeal[k]?.value);
  if (hasDealFields) return onDeal;
  if (MEDDPICC_ACCOUNT_FALLBACK && account?.metadata?.meddpicc) {
    return account.metadata.meddpicc;
  }
  return onDeal || null;
}

/**
 * Merge a MEDDPICC field slot without downgrading confirmed values.
 * @param {object|undefined} existing
 * @param {object|undefined} incoming
 */
export function mergeFieldSlot(existing, incoming) {
  if (!incoming?.value || !String(incoming.value).trim()) return existing;
  const incStatus = incoming.status || "partial";
  const curStatus = existing?.status || "unknown";
  if (STATUS_RANK[curStatus] === 2 && STATUS_RANK[incStatus] < 2) return existing;
  if (
    existing?.value === incoming.value &&
    existing?.status === incStatus &&
    existing?.contactId === incoming.contactId
  ) {
    return existing;
  }
  return {
    value: String(incoming.value).trim(),
    status: incStatus,
    source: incoming.source || existing?.source,
    updatedAt: incoming.updatedAt || now(),
    contactId: incoming.contactId ?? existing?.contactId,
  };
}

/** @param {object} meddpicc */
export function computeMeddpiccScore(meddpicc) {
  if (!meddpicc) return 0;
  let filled = 0;
  for (const key of MEDDPICC_FIELD_KEYS) {
    const slot = meddpicc[key];
    if (slot?.value && slot.status !== "unknown") filled += 1;
  }
  return Math.round((filled / MEDDPICC_FIELD_KEYS.length) * 100);
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapDecisionPower(power) {
  const p = String(power || "").toLowerCase();
  if (p === "decision_maker") return { level: "high", decisionRole: "economic_buyer" };
  if (p === "influencer") return { level: "medium", decisionRole: "influencer" };
  return { level: "unknown", decisionRole: "unknown" };
}

function mapPostCallInfluence(influence) {
  const level = String(influence || "unknown").toLowerCase();
  if (level === "high" || level === "medium" || level === "low") {
    return { level, decisionRole: level === "high" ? "champion" : "influencer" };
  }
  return { level: "unknown", decisionRole: "unknown" };
}

function mergeDisc(existing, hint, source, ts) {
  if (!hint?.primary && !hint?.secondary && !hint?.evidence?.length) return existing;
  const cur = existing || {};
  const incomingConfidence = hint.confidence || "low";
  const rank = { low: 0, medium: 1, high: 2 };
  if (cur.primary && rank[cur.confidence || "low"] > rank[incomingConfidence]) return cur;

  const evidence = [...new Set([...(cur.evidence || []), ...(hint.evidence || [])])].slice(0, 8);
  return {
    primary: hint.primary || cur.primary || "unknown",
    secondary: hint.secondary || cur.secondary,
    confidence: hint.primary ? incomingConfidence : cur.confidence || "low",
    evidence: evidence.length ? evidence : cur.evidence,
    assessedAt: ts,
    source: source || cur.source,
  };
}

function mergeInfluence(existing, incoming, source, ts) {
  if (!incoming?.level || incoming.level === "unknown") return existing;
  const cur = existing || {};
  const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
  if (rank[cur.level || "unknown"] > rank[incoming.level]) return cur;
  return {
    level: incoming.level,
    decisionRole: incoming.decisionRole || cur.decisionRole || "unknown",
    source: source || cur.source,
    updatedAt: ts,
  };
}

/**
 * Build contact metadata patch from prep prospect + optional attendee match.
 * @param {object|null|undefined} contact
 * @param {{ prospectMeta?: object, attendee?: object, discHint?: object, ts?: number }} ctx
 */
export function mergeContactFromPrep(contact, ctx = {}) {
  const ts = ctx.ts || now();
  const meta = { ...(contact?.metadata || {}) };
  const changes = [];
  const pm = ctx.prospectMeta;

  const disc = mergeDisc(meta.disc, ctx.discHint || pm?.discHint, pm?.discHint?.source || "prep", ts);
  if (JSON.stringify(disc) !== JSON.stringify(meta.disc)) {
    meta.disc = disc;
    changes.push("disc");
  }

  let influencePatch = null;
  if (pm?.influence?.level && pm.influence.level !== "unknown") {
    influencePatch = pm.influence;
  } else if (ctx.attendee?.decisionPower) {
    influencePatch = mapDecisionPower(ctx.attendee.decisionPower);
  }
  const influence = mergeInfluence(meta.influence, influencePatch, "prep", ts);
  if (JSON.stringify(influence) !== JSON.stringify(meta.influence)) {
    meta.influence = influence;
    changes.push("influence");
  }

  if (pm) {
    const research = { ...(meta.research || {}) };
    let researchChanged = false;
    const fields = [
      ["experienceSummary", pm.totalExperience],
      ["priorEmployers", pm.priorEmployers],
      ["competitorTouchpoints", pm.competitorTouchpoints],
      ["summary", pm.summary],
      ["skills", pm.skills],
      ["languages", pm.languages],
      ["education", pm.education],
    ];
    for (const [key, val] of fields) {
      if (val === undefined || val === null || val === "" || (Array.isArray(val) && !val.length)) continue;
      if (JSON.stringify(research[key]) !== JSON.stringify(val)) {
        research[key] = val;
        researchChanged = true;
      }
    }
    if (researchChanged) {
      research.lastResearchedAt = ts;
      meta.research = research;
      changes.push("research");
    }
  }

  return { metadata: meta, changes };
}

/** Soft MEDDPICC hints from high-influence enriched prospect. */
export function meddpiccSignalsFromProspectInfluence(prospectMeta, contactId) {
  if (!prospectMeta?.influence || prospectMeta.influence.level !== "high") return {};
  const name = prospectMeta.name || "Prospect";
  const role = prospectMeta.role || prospectMeta.influence.decisionRole || "";
  const value = role ? `${name}. ${role}` : name;
  const out = {};
  const dr = String(prospectMeta.influence.decisionRole || "").toLowerCase();
  if (dr.includes("economic") || dr.includes("buyer")) {
    out.economicBuyer = { value, status: "partial", contactId };
  } else {
    out.champion = { value, status: "partial", contactId };
  }
  return out;
}

/** @param {object|null|undefined} contact @param {object} enrichment API response */
export function mergeContactFromEnrichment(contact, enrichment) {
  const ts = now();
  const prospectMeta = {
    name: enrichment.profile?.name,
    role: enrichment.profile?.role,
    totalExperience: enrichment.profile?.totalExperience,
    priorEmployers: enrichment.profile?.priorEmployers,
    competitorTouchpoints: enrichment.profile?.competitorTouchpoints,
    summary: enrichment.profile?.summary,
    skills: enrichment.profile?.skills,
    languages: enrichment.profile?.languages,
    education: enrichment.profile?.education,
    discHint: enrichment.disc,
    influence: enrichment.influence,
  };
  return mergeContactFromPrep(contact, { prospectMeta, discHint: enrichment.disc, ts });
}

/** @param {object|null|undefined} contact @param {object} attendee */
export function mergeContactFromPostCall(contact, attendee) {
  const ts = now();
  const meta = { ...(contact?.metadata || {}) };
  const changes = [];

  const influencePatch = mapPostCallInfluence(attendee?.influence);
  const influence = mergeInfluence(meta.influence, influencePatch, "postcall", ts);
  if (JSON.stringify(influence) !== JSON.stringify(meta.influence)) {
    meta.influence = influence;
    changes.push("influence");
  }

  if (attendee?.name && attendee?.role) {
    const evidence = [...(meta.disc?.evidence || [])];
    const line = `${attendee.name}: ${attendee.role} (${attendee.influence || "unknown"} influence)`;
    if (!evidence.includes(line)) evidence.push(line);
    if (evidence.length !== (meta.disc?.evidence || []).length) {
      meta.disc = { ...(meta.disc || {}), evidence: evidence.slice(0, 8), assessedAt: ts, source: "postcall" };
      if (!changes.includes("disc")) changes.push("disc");
    }
  }

  return { metadata: meta, changes, patch: {
    name: contact?.name || attendee?.name,
    title: contact?.title || attendee?.role,
    role: contact?.role || attendee?.role,
  } };
}

/** Extract MEDDPICC hints from prep JSON. */
export function meddpiccSignalsFromPrep(prep) {
  const hints = prep?.meddpiccHints;
  const out = {};
  if (hints && typeof hints === "object") {
    for (const key of MEDDPICC_FIELD_KEYS) {
      const raw = hints[key];
      if (!raw?.value) continue;
      out[key] = {
        value: raw.value,
        status: raw.status || "partial",
        contactId: raw.contactId,
      };
    }
  }
  if (prep?.likelyPains?.length && !out.identifyPain) {
    out.identifyPain = {
      value: prep.likelyPains.slice(0, 2).join("; "),
      status: "partial",
    };
  }
  return out;
}

/** Extract MEDDPICC signals from Pass 4 qualification output. */
export function meddpiccSignalsFromQualification(qualification) {
  const out = {};
  if (!qualification || typeof qualification !== "object") return out;

  for (const key of MEDDPICC_FIELD_KEYS) {
    const el = qualification[key];
    if (!el?.surfaced || !String(el.value || "").trim()) continue;
    out[key] = {
      value: String(el.value).trim(),
      status: inferQualificationSlotStatus(el),
      contactId: el.contactId || undefined,
    };
  }
  return out;
}

function inferQualificationSlotStatus(el) {
  const evidence = String(el.evidence || "").toLowerCase();
  if (
    /\b(i am|we are|confirmed|sign.?off|final approv|budget owner|economic buyer|procurement|legal review scheduled)\b/.test(
      evidence,
    )
  ) {
    return "confirmed";
  }
  return "partial";
}

/**
 * Build per-call MEDDPICC delta drafts before deal merge is applied.
 * @param {string} dealId
 * @param {string} callId
 * @param {object|null|undefined} previousMeddpicc
 * @param {object} qualification
 */
export function buildMeddpiccDeltaDrafts(dealId, callId, previousMeddpicc, qualification) {
  if (!dealId || !callId || !qualification) return [];
  const deltas = [];
  const ts = now();

  for (const slot of MEDDPICC_FIELD_KEYS) {
    const el = qualification[slot];
    if (!el?.surfaced || !String(el.value || "").trim()) continue;

    const incoming = {
      value: String(el.value).trim(),
      status: inferQualificationSlotStatus(el),
      source: "postcall",
      updatedAt: ts,
      contactId: el.contactId || undefined,
    };
    const previous = previousMeddpicc?.[slot] || null;
    const merged = mergeFieldSlot(previous, incoming);

    if (!merged) continue;

    const blockedDowngrade =
      previous &&
      STATUS_RANK[previous.status || "unknown"] === 2 &&
      STATUS_RANK[incoming.status || "partial"] < 2;
    if (blockedDowngrade) continue;

    const sameSlot =
      previous?.value === merged.value &&
      previous?.status === merged.status &&
      (previous?.contactId || null) === (merged.contactId || null);

    let changeType;
    if (!previous?.value) {
      changeType = "new";
    } else if (previous.value !== merged.value || (previous.contactId || null) !== (merged.contactId || null)) {
      changeType = "changed";
    } else {
      changeType = "confirmed";
    }

    if (sameSlot && changeType !== "confirmed") continue;

    deltas.push({
      callId,
      dealId,
      slot,
      previous,
      current: merged,
      changeType,
      evidence: el.evidence || "not surfaced",
    });
  }

  return deltas;
}

/** Extract MEDDPICC signals from post-call analysis (legacy. prefer Pass 4 qualification). */
export function meddpiccSignalsFromPostCall(analysis) {
  const qualification = analysis?.qualification;
  if (qualification && typeof qualification === "object") {
    return meddpiccSignalsFromQualification(qualification);
  }

  const dq = analysis?.dealQualification;
  const out = {};
  if (dq && typeof dq === "object") {
    for (const key of MEDDPICC_FIELD_KEYS) {
      const raw = dq[key];
      if (!raw?.value) continue;
      out[key] = {
        value: raw.value,
        status: raw.status || "partial",
        contactId: raw.contactId,
      };
    }
  }

  const pains = analysis?.signals?.painsConfirmed;
  if (pains?.length && !out.identifyPain) {
    out.identifyPain = { value: pains.slice(0, 2).join("; "), status: "partial" };
  }

  const competitors = analysis?.signals?.competitors;
  if (competitors?.length && !out.competition) {
    out.competition = { value: competitors.slice(0, 2).join("; "), status: "partial" };
  }

  const momentum = analysis?.momentum;
  if (momentum?.topAction && !out.decisionProcess) {
    out.decisionProcess = {
      value: `${momentum.topAction}${momentum.topActionDue ? ` (${momentum.topActionDue})` : ""}`,
      status: "partial",
    };
  }

  return out;
}

/**
 * @param {string} dealId
 * @param {string} accountId
 * @param {object} signals
 * @param {"prep"|"postcall"|"manual"|"migration"} source
 */
async function applyMeddpiccSignalsToDeal(dealId, accountId, signals, source) {
  if (!signals || !Object.keys(signals).length) return null;
  if (!dealId) {
    console.warn("[meddpicc] skipped write: missing dealId for account", accountId);
    return null;
  }
  const store = getStore();
  let deal = await store.getDeal(dealId);
  if (!deal || deal.accountId !== accountId) return null;
  const patch = mergeDealMeddpicc(deal, signals, source);
  if (!patch) return null;
  return store.updateDeal(dealId, patch);
}

function appendMeddpiccSignals(target, addition) {
  if (!addition) return target;
  const out = { ...target };
  for (const key of Object.keys(addition)) {
    if (!out[key]) out[key] = addition[key];
  }
  return out;
}

function findAttendeeForProspect(attendees, prospectMeta, email) {
  const nameKey = normalizeName(prospectMeta?.name);
  if (!nameKey) return null;
  return (attendees || []).find((a) => normalizeName(a.name) === nameKey) || null;
}

/**
 * @param {string} accountId
 * @param {object} prep
 * @param {string[]} emails
 * @param {{ lifecycleId?: string, actorId?: string, prepBriefId?: string, dealId?: string|null }} ctx
 */
export async function applyPrepContactFrameworks(accountId, prep, emails, ctx = {}) {
  const store = getStore();
  const ts = now();
  const attendees = prep?.attendees || [];
  const prospects = prep?.prospects || [];

  let medSignalsAccum = meddpiccSignalsFromPrep(prep);

  const allChanges = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const prospectMeta = prospects[i] || prospects.find((p) => normalizeName(p?.name) === normalizeName(email));
    const contact = await store.findContactByAccountEmail(accountId, email);
    if (!contact) continue;

    const influenceSignals = meddpiccSignalsFromProspectInfluence(prospectMeta, contact.id);
    medSignalsAccum = appendMeddpiccSignals(medSignalsAccum, influenceSignals);

    const attendee = findAttendeeForProspect(attendees, prospectMeta, email);
    const { metadata, changes } = mergeContactFromPrep(contact, {
      prospectMeta,
      attendee,
      discHint: prospectMeta?.discHint,
      ts,
    });

    if (changes.length) {
      await store.updateContact(contact.id, { metadata });
      await recordContactEvent(contact.id, "linked_from_prep", ctx.actorId || "system", {
        fields: changes,
        lifecycleId: ctx.lifecycleId,
        artifactId: ctx.prepBriefId,
        source: "prep",
      });
      if (ctx.lifecycleId && ctx.actorId) {
        await emitLifecycleContactUpdated(ctx.lifecycleId, ctx.actorId, contact, changes);
      }
      allChanges.push({ contactId: contact.id, fields: changes });
    }
  }

  const updatedDeal = await applyMeddpiccSignalsToDeal(ctx.dealId, accountId, medSignalsAccum, "prep");

  return { dealMetadata: updatedDeal?.metadata, contactChanges: allChanges };
}

/**
 * Match post-call attendees to contacts; create when email present.
 * @param {string} accountId
 * @param {object} analysis
 * @param {{ lifecycleId?: string, actorId?: string, postCallId?: string, dealId?: string|null, participantEmails?: string[] }} ctx
 */
export async function applyPostCallContactFrameworks(accountId, analysis, ctx = {}) {
  const store = getStore();
  const attendees = [...(analysis?.callHeader?.attendees || [])];

  // Contact-primary: ensure every SE-typed email becomes a contact, even if the
  // transcript-derived attendee list missed it.
  const attendeeEmails = new Set(
    attendees.map((a) => String(a.email || "").trim().toLowerCase()).filter(Boolean),
  );
  for (const raw of ctx.participantEmails || []) {
    const email = String(raw || "").trim().toLowerCase();
    if (email.includes("@") && !attendeeEmails.has(email)) {
      attendees.push({ email });
      attendeeEmails.add(email);
    }
  }

  const skipMedMerge = !!(ctx.qualification || analysis?.qualification);
  let updatedDeal = null;
  if (!skipMedMerge) {
    const medSignals = meddpiccSignalsFromPostCall(analysis);
    updatedDeal = await applyMeddpiccSignalsToDeal(ctx.dealId, accountId, medSignals, "postcall");
  }

  const contacts = await store.listContactsByAccount(accountId);
  const allChanges = [];
  const account = store.getAccount ? await store.getAccount(accountId).catch(() => null) : null;

  for (const attendee of attendees) {
    let contact = null;
    const email = String(attendee.email || "").trim().toLowerCase();
    if (email && email.includes("@")) {
      contact = await store.findContactByAccountEmail(accountId, email);
      if (!contact) {
        contact = await store.createContact(
          contactScopeFromAccount(account || { id: accountId }, {
            id: newId("contact"),
            accountId,
            email,
            name: attendee.name || email.split("@")[0],
            title: attendee.role || null,
            role: attendee.role || null,
            createdAt: now(),
            updatedAt: now(),
          }),
        );
        await recordContactEvent(contact.id, "contact_created", ctx.actorId || "system", {
          source: "postcall",
          lifecycleId: ctx.lifecycleId,
          artifactId: ctx.postCallId,
        });
      }
    } else {
      const nameKey = normalizeName(attendee.name);
      contact = contacts.find((c) => normalizeName(c.name) === nameKey) || null;
    }
    if (!contact) continue;

    const { metadata, changes, patch } = mergeContactFromPostCall(contact, attendee);
    const updatePatch = { metadata };
    if (patch.name && !contact.name) updatePatch.name = patch.name;
    if (patch.title && !contact.title) updatePatch.title = patch.title;
    if (patch.role && !contact.role) updatePatch.role = patch.role;

    if (changes.length) {
      await store.updateContact(contact.id, updatePatch);
      await recordContactEvent(contact.id, "linked_from_postcall", ctx.actorId || "system", {
        fields: changes,
        lifecycleId: ctx.lifecycleId,
        artifactId: ctx.postCallId,
        source: "postcall",
      });
      if (ctx.lifecycleId && ctx.actorId) {
        await emitLifecycleContactUpdated(ctx.lifecycleId, ctx.actorId, contact, changes);
      }
      allChanges.push({ contactId: contact.id, fields: changes });
    }
  }

  return { dealMetadata: updatedDeal?.metadata, contactChanges: allChanges };
}

/** @param {string} contactId @param {import("./types.js").ContactEventType} type @param {string} actorId @param {object} payload */
/**
 * Ensure a customer attendee exists on the account (confirm gate / manual add).
 * @param {string} accountId
 * @param {{ name?: string, email?: string, title?: string }} attendee
 * @param {{ actorId?: string, source?: string }} [ctx]
 */
export async function ensureCustomerContact(accountId, attendee, ctx = {}) {
  const store = getStore();
  const email = String(attendee.email || "").trim().toLowerCase();
  if (!accountId || !email || !email.includes("@")) return null;

  let contact = await store.findContactByAccountEmail(accountId, email);
  if (contact) return contact;

  const account = store.getAccount ? await store.getAccount(accountId).catch(() => null) : null;
  contact = await store.createContact(
    contactScopeFromAccount(account || { id: accountId }, {
      id: newId("contact"),
      accountId,
      email,
      name: attendee.name || email.split("@")[0],
      title: attendee.title || null,
      role: "Customer",
      createdAt: now(),
      updatedAt: now(),
    }),
  );
  await recordContactEvent(contact.id, "contact_created", ctx.actorId || "system", {
    source: ctx.source || "postcall_confirm",
  });
  return contact;
}

export async function recordContactEvent(contactId, type, actorId, payload = {}) {
  const store = getStore();
  if (!store.addContactEvent) return null;
  const event = {
    id: newId("contactEvent"),
    contactId,
    type,
    actorId: actorId || "system",
    timestamp: now(),
    payload,
  };
  return store.addContactEvent(event);
}

/** @param {string} contactId @param {number} [limit] */
export async function listContactActivity(contactId, limit = 10) {
  const store = getStore();
  if (!store.listContactEvents) return [];
  return store.listContactEvents(contactId, limit);
}

async function emitLifecycleContactUpdated(lifecycleId, actorId, contact, fields) {
  const store = getStore();
  if (!store.addLifecycleEvent) return;
  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "contact_updated",
    actorId,
    timestamp: now(),
    payload: {
      contactId: contact.id,
      contactName: contact.name || contact.email,
      fields,
    },
  });
}

/** Load contact events keyed by contact id. */
export async function loadContactEventsForAccount(contacts, limitPerContact = 10) {
  /** @type {Record<string, object[]>} */
  const byContact = {};
  await Promise.all(
    (contacts || []).map(async (c) => {
      byContact[c.id] = await listContactActivity(c.id, limitPerContact);
    })
  );
  return byContact;
}
