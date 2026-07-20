/**
 * Contact merge, MEDDPICC rollup, and contact-scoped activity events.
 */

import { getStore } from "./store.js";
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

/** @param {object|undefined} existingMeta @param {object} signals @param {"prep"|"postcall"|"manual"} source */
export function mergeAccountMeddpicc(existingMeta, signals, source) {
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
  const value = role ? `${name} — ${role}` : name;
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

/** Extract MEDDPICC signals from post-call analysis. */
export function meddpiccSignalsFromPostCall(analysis) {
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

function findAttendeeForProspect(attendees, prospectMeta, email) {
  const nameKey = normalizeName(prospectMeta?.name);
  if (!nameKey) return null;
  return (attendees || []).find((a) => normalizeName(a.name) === nameKey) || null;
}

/**
 * @param {string} accountId
 * @param {object} prep
 * @param {string[]} emails
 * @param {{ lifecycleId?: string, actorId?: string, prepBriefId?: string }} ctx
 */
export async function applyPrepContactFrameworks(accountId, prep, emails, ctx = {}) {
  const store = getStore();
  const ts = now();
  const attendees = prep?.attendees || [];
  const prospects = prep?.prospects || [];
  const account = await store.getAccount(accountId);
  let accountMeta = account?.metadata;

  const medSignals = meddpiccSignalsFromPrep(prep);
  if (Object.keys(medSignals).length) {
    accountMeta = mergeAccountMeddpicc(accountMeta, medSignals, "prep");
  }

  const allChanges = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const prospectMeta = prospects[i] || prospects.find((p) => normalizeName(p?.name) === normalizeName(email));
    const contact = await store.findContactByAccountEmail(accountId, email);
    if (!contact) continue;

    const influenceSignals = meddpiccSignalsFromProspectInfluence(prospectMeta, contact.id);
    if (Object.keys(influenceSignals).length) {
      accountMeta = mergeAccountMeddpicc(accountMeta, influenceSignals, "prep");
    }

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

  if (JSON.stringify(accountMeta) !== JSON.stringify(account?.metadata)) {
    await store.updateAccount(accountId, { metadata: accountMeta });
  }

  return { accountMetadata: accountMeta, contactChanges: allChanges };
}

/**
 * Match post-call attendees to contacts; create when email present.
 * @param {string} accountId
 * @param {object} analysis
 * @param {{ lifecycleId?: string, actorId?: string, postCallId?: string }} ctx
 */
export async function applyPostCallContactFrameworks(accountId, analysis, ctx = {}) {
  const store = getStore();
  const attendees = analysis?.callHeader?.attendees || [];
  const account = await store.getAccount(accountId);
  let accountMeta = account?.metadata;

  const medSignals = meddpiccSignalsFromPostCall(analysis);
  if (Object.keys(medSignals).length) {
    accountMeta = mergeAccountMeddpicc(accountMeta, medSignals, "postcall");
    await store.updateAccount(accountId, { metadata: accountMeta });
  }

  const contacts = await store.listContactsByAccount(accountId);
  const allChanges = [];

  for (const attendee of attendees) {
    let contact = null;
    const email = String(attendee.email || "").trim().toLowerCase();
    if (email && email.includes("@")) {
      contact = await store.findContactByAccountEmail(accountId, email);
      if (!contact) {
        contact = await store.createContact({
          id: newId("contact"),
          accountId,
          email,
          name: attendee.name,
          title: attendee.role,
          role: attendee.role,
          createdAt: now(),
          updatedAt: now(),
        });
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

  return { accountMetadata: accountMeta, contactChanges: allChanges };
}

/** @param {string} contactId @param {import("./types.js").ContactEventType} type @param {string} actorId @param {object} payload */
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
