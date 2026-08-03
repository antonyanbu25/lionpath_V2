/**
 * Merge duplicate call identities (transcript names, emails, CRM contacts)
 * into one attendee row for post-call confirm and persisted analysis.
 */

/** Collapse duplicate display names (case-insensitive; strip role suffixes; email → local part). */
export function normalizePersonKey(label) {
  let key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\|.*$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = key.indexOf("@");
  if (at >= 0) {
    key = key
      .slice(0, at)
      .replace(/[._-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return key;
}

/** Fuzzy match between a stored identity label and a spoken/transcript name. */
export function identityMatchesName(identity, geminiName) {
  const idKey = normalizePersonKey(identity);
  const nameKey = normalizePersonKey(geminiName);
  if (!idKey || !nameKey) return false;
  if (idKey === nameKey) return true;
  if (nameKey.includes(idKey) || idKey.includes(nameKey)) return true;
  const idFirst = idKey.split(/\s+/)[0] || "";
  const nameFirst = nameKey.split(/\s+/)[0] || "";
  if (idFirst.length >= 3 && idFirst === nameFirst) return true;
  const idLast = idKey.split(/\s+/).pop() || "";
  const nameLast = nameKey.split(/\s+/).pop() || "";
  if (idLast.length >= 3 && idLast === nameLast) return true;
  return false;
}

/** Prefer a spoken name over an email or noisier variant when merging duplicates. */
export function preferPersonLabel(a, b) {
  const score = (s) => {
    const t = String(s || "").trim();
    if (!t) return -1;
    if (/@/.test(t)) return 0;
    if (/\s/.test(t)) return 3;
    return 2;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return String(a).trim().length <= String(b).trim().length ? a : b;
}

export function dedupePersonLabels(labels) {
  const byKey = new Map();
  for (const raw of labels || []) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const key = normalizePersonKey(label);
    if (!key) continue;
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferPersonLabel(prev, label) : label);
  }
  return [...byKey.values()];
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailLocalPart(email) {
  const e = normalizeEmail(email);
  const at = e.indexOf("@");
  if (at < 0) return "";
  return e
    .slice(0, at)
    .replace(/[._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNameToken(label) {
  const key = normalizePersonKey(label);
  return (
    key.split(/\s+/).find((t) => t.length >= 3 && !/^(mr|mrs|ms|dr)$/.test(t)) || ""
  );
}

/** True when a transcript-style name plausibly matches an email local part (not bare initials). */
export function speakerMatchesEmailLocal(speakerLabel, email) {
  const token = firstNameToken(speakerLabel);
  if (!token) return false;
  const local = emailLocalPart(email);
  if (!local) return false;
  if (identityMatchesName(speakerLabel, email)) return true;
  const localFirst = local.split(/\s+/)[0] || "";
  if (localFirst.length >= 3 && localFirst === token) return true;
  if (local === token) return true;
  if (local.startsWith(`${token} `) || local.startsWith(token)) return true;
  return false;
}

function identityLabel(entry) {
  return String(entry?.label || entry?.name || entry?.email || "").trim();
}

/** Block merges where both sides collapse to very short tokens (e.g. "se" vs se@…). */
function isAmbiguousShortIdentityMatch(a, b) {
  const labelA = identityLabel(a);
  const labelB = identityLabel(b);
  const keyA = normalizePersonKey(labelA);
  const keyB = normalizePersonKey(labelB);
  const emailA = normalizeEmail(a.email) || (labelA.includes("@") ? normalizeEmail(labelA) : "");
  const emailB = normalizeEmail(b.email) || (labelB.includes("@") ? normalizeEmail(labelB) : "");
  const tokens = [
    keyA,
    keyB,
    emailLocalPart(emailA).split(/\s+/)[0] || "",
    emailLocalPart(emailB).split(/\s+/)[0] || "",
  ].filter(Boolean);
  if (!tokens.length) return true;
  const longest = Math.max(...tokens.map((t) => t.length));
  return longest < 3;
}

function contactBridgesEntries(a, b, contacts) {
  for (const c of contacts || []) {
    const cEmail = normalizeEmail(c?.email);
    const cName = String(c?.name || c?.label || "").trim();
    if (!cEmail && !cName) continue;
    const aEmail = normalizeEmail(a?.email);
    const bEmail = normalizeEmail(b?.email);
    const aName = identityLabel(a);
    const bName = identityLabel(b);
    const aEmailMatch = aEmail && cEmail && aEmail === cEmail;
    const bEmailMatch = bEmail && cEmail && bEmail === cEmail;
    const aNameMatch = cName && (identityMatchesName(aName, cName) || identityMatchesName(a?.name, cName));
    const bNameMatch = cName && (identityMatchesName(bName, cName) || identityMatchesName(b?.name, cName));
    if ((aEmailMatch && bNameMatch) || (bEmailMatch && aNameMatch) || (aEmailMatch && bEmailMatch)) {
      return true;
    }
  }
  return false;
}

function transcriptBridgesEntries(a, b, transcriptSpeakers) {
  for (const speaker of transcriptSpeakers || []) {
    const sp = String(speaker || "").trim();
    if (!sp) continue;
    const aLabel = identityLabel(a);
    const bLabel = identityLabel(b);
    const aEmail = normalizeEmail(a?.email);
    const bEmail = normalizeEmail(b?.email);
    if (identityMatchesName(sp, aLabel) && bEmail && speakerMatchesEmailLocal(sp, bEmail)) return true;
    if (identityMatchesName(sp, bLabel) && aEmail && speakerMatchesEmailLocal(sp, aEmail)) return true;
  }
  return false;
}

/** @returns {boolean} */
export function identitiesShouldMerge(a, b, contacts = [], transcriptSpeakers = []) {
  if (!a || !b || a === b) return false;
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  if (emailA && emailB && emailA === emailB) return true;

  const labelA = identityLabel(a);
  const labelB = identityLabel(b);
  if (labelA && labelB && identityMatchesName(labelA, labelB) && !isAmbiguousShortIdentityMatch(a, b)) {
    return true;
  }
  if (emailA && labelB && identityMatchesName(labelB, emailA) && !isAmbiguousShortIdentityMatch(a, b)) {
    return true;
  }
  if (emailB && labelA && identityMatchesName(labelA, emailB) && !isAmbiguousShortIdentityMatch(a, b)) {
    return true;
  }

  if (transcriptBridgesEntries(a, b, transcriptSpeakers)) return true;
  if (contactBridgesEntries(a, b, contacts)) return true;
  return false;
}

const ROLE_RANK = {
  "Primary SE": 50,
  AE: 40,
  "Secondary SE": 30,
  Partner: 20,
  Customer: 10,
};

function pickBestRole(entries) {
  const userAssigned = entries.find((e) => e.userAssignedRole && e.role);
  if (userAssigned) return userAssigned.role;
  const primary = entries.find((e) => e.role === "Primary SE");
  if (primary) return "Primary SE";
  return entries.reduce((best, e) => {
    const role = e.role || "Customer";
    const rank = ROLE_RANK[role] ?? 0;
    const bestRank = ROLE_RANK[best] ?? 0;
    return rank > bestRank ? role : best;
  }, entries[0]?.role || "Customer");
}

function scoreDisplayName(name, contacts) {
  const n = String(name || "").trim();
  if (!n) return -1;
  for (const c of contacts || []) {
    const cName = String(c?.name || c?.label || "").trim();
    if (cName && identityMatchesName(n, cName) && /\s/.test(cName)) return 100 + cName.length;
  }
  if (/@/.test(n)) return 0;
  if (/\s/.test(n)) return 50 + Math.min(n.length, 30);
  return 10 + Math.min(n.length, 20);
}

function titleCaseName(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function pickBestName(entries, contacts) {
  let best = "";
  let bestScore = -1;
  for (const e of entries) {
    for (const candidate of [e.name, e.label].filter(Boolean)) {
      const score = scoreDisplayName(candidate, contacts);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  if (best) {
    if (!/@/.test(best) && !/\s/.test(best) && bestScore < 50) {
      return titleCaseName(best);
    }
    return best;
  }
  return preferPersonLabel(...entries.map((e) => e.name || e.label || e.email).filter(Boolean)) || "Attendee";
}

function pickBestEmail(entries) {
  for (const e of entries) {
    const email = normalizeEmail(e.email);
    if (email) return email;
  }
  for (const e of entries) {
    const fromLabel = identityLabel(e).match(/[^\s,]+@[^\s,]+/);
    if (fromLabel) return fromLabel[0].toLowerCase();
  }
  return null;
}

function mergeCluster(entries, contacts) {
  const name = pickBestName(entries, contacts);
  const email = pickBestEmail(entries);
  const role = pickBestRole(entries);
  const label = preferPersonLabel(name, email || name);
  const manual = entries.some((e) => e.manual);
  const userAssignedRole = entries.some((e) => e.userAssignedRole);
  const id = normalizePersonKey(email || name || label);
  return {
    id,
    name: name || (email ? email.split("@")[0].replace(/[._-]+/g, " ") : "Attendee"),
    email,
    label,
    detail: email || label,
    role,
    manual,
    userAssignedRole,
  };
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Collapse duplicate call identities into one row per real person.
 * @param {object[]} attendees parsed attendee rows ({ name, email, label, role, ... })
 * @param {object[]} [contacts] CRM/account contacts ({ name, email, label })
 * @param {string[]} [transcriptSpeakers] speaker names from transcript
 * @returns {object[]}
 */
export function mergeCallIdentities(attendees, contacts = [], transcriptSpeakers = []) {
  const list = (attendees || []).filter((a) => identityLabel(a));
  if (list.length <= 1) return list;

  const uf = new UnionFind(list.length);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (identitiesShouldMerge(list[i], list[j], contacts, transcriptSpeakers)) {
        uf.union(i, j);
      }
    }
  }

  /** @type {Map<number, object[]>} */
  const clusters = new Map();
  for (let i = 0; i < list.length; i++) {
    const root = uf.find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(list[i]);
  }

  return [...clusters.values()].map((group) => mergeCluster(group, contacts));
}
