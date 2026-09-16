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

function compactAlpha(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Tiny closed nickname list — SE-call given names only, not a general fuzzy. */
const GIVEN_NAME_ALIASES = {
  matt: ["matthew"],
  matthew: ["matt"],
  mike: ["michael"],
  michael: ["mike"],
  dave: ["david"],
  david: ["dave"],
  dan: ["daniel"],
  daniel: ["dan"],
  chris: ["christopher"],
  christopher: ["chris"],
};

function givenNameVariants(first) {
  const f = String(first || "")
    .trim()
    .toLowerCase();
  if (!f) return [];
  return [f, ...(GIVEN_NAME_ALIASES[f] || [])];
}

/** first+last, first+lastInitial, firstInitial+last (plus nickname expansions). */
function emailLocalConcatenations(personName) {
  const tokens = normalizePersonKey(personName)
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set();
  if (!tokens.length) return out;
  const last = tokens.length >= 2 ? tokens[tokens.length - 1] : "";
  for (const first of givenNameVariants(tokens[0])) {
    out.add(first);
    if (last.length >= 3) {
      out.add(`${first}${last}`);
      out.add(`${first[0]}${last}`);
      if (first.length >= 3) out.add(`${first}${last[0]}`);
    }
  }
  return out;
}

/**
 * Email local-part (digits/punctuation stripped) vs a person's name.
 * `matthewn` / `mattnewman` / `mnewman` match Matt Newman / Matthew Newman.
 * Rejects short locals so `se@` cannot match into a last name.
 */
export function emailLocalMatchesName(emailOrLocal, personName) {
  const raw = String(emailOrLocal || "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  const local = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  const compact = compactAlpha(local);
  if (compact.length < 4) return false;
  if (emailLocalConcatenations(personName).has(compact)) return true;

  const localTokens = local.replace(/[._+\-]/g, " ").split(/\s+/).filter(Boolean);
  const nameTokens = normalizePersonKey(personName)
    .split(/\s+/)
    .filter(Boolean);
  if (nameTokens.length < 2 || localTokens.length < 2) return false;
  const last = nameTokens[nameTokens.length - 1];
  if (last.length < 3) return false;
  const localFirst = compactAlpha(localTokens[0]);
  const localRest = compactAlpha(localTokens.slice(1).join(""));
  if (!localFirst || !localRest) return false;
  const firsts = givenNameVariants(nameTokens[0]);
  let firstOk = firsts.includes(localFirst);
  if (!firstOk) {
    for (const first of firsts) {
      const [shorter, longer] =
        first.length <= localFirst.length ? [first, localFirst] : [localFirst, first];
      if (shorter.length >= 4 && longer.startsWith(shorter)) {
        firstOk = true;
        break;
      }
    }
  }
  if (!firstOk) return false;
  return localRest === last || localRest === last[0] || last.startsWith(localRest);
}

function firstNameToken(label) {
  const key = normalizePersonKey(label);
  return (
    key.split(/\s+/).find((t) => t.length >= 3 && !/^(mr|mrs|ms|dr)$/.test(t)) || ""
  );
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Conservative first-name similarity: exact, strong prefix (5+ chars), or 1-edit
 * / ≤20% relative distance on names of 5+ letters. Rejects "starts with A".
 */
export function firstNamesSimilar(a, b) {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const minLen = Math.min(left.length, right.length);
  const maxLen = Math.max(left.length, right.length);
  if (minLen < 4) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= 5 && longer.startsWith(shorter)) return true;
  const dist = levenshtein(left, right);
  if (dist === 1 && minLen >= 5) return true;
  if (minLen >= 5 && dist / maxLen <= 0.2) return true;
  return false;
}

function hasDistinctLastName(key) {
  const tokens = String(key || "").split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens[tokens.length - 1] !== tokens[0];
}

/** Whole-token / prefix contains — never mid-token ("se" inside "salasevicius"). */
function containsAtTokenBoundary(haystack, needle) {
  if (!haystack || !needle || needle.length < 3) return false;
  if (haystack === needle) return true;
  if (haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`)) return true;
  if (haystack.includes(` ${needle} `)) return true;
  if (needle.length >= 4 && haystack.startsWith(needle)) return true;
  return false;
}

/** Fuzzy match between a stored identity label and a spoken/transcript name. */
export function identityMatchesName(identity, geminiName) {
  const idKey = normalizePersonKey(identity);
  const nameKey = normalizePersonKey(geminiName);
  if (!idKey || !nameKey) return false;
  if (idKey === nameKey) return true;
  if (containsAtTokenBoundary(nameKey, idKey) || containsAtTokenBoundary(idKey, nameKey)) return true;
  // Unspaced email-style local ("matthewn") vs spaced full name ("Matt Newman").
  const idUnspaced = !/\s/.test(idKey);
  const nameUnspaced = !/\s/.test(nameKey);
  if (idUnspaced && !nameUnspaced && emailLocalMatchesName(idKey, nameKey)) return true;
  if (nameUnspaced && !idUnspaced && emailLocalMatchesName(nameKey, idKey)) return true;
  const idTokens = idKey.split(/\s+/).filter(Boolean);
  const nameTokens = nameKey.split(/\s+/).filter(Boolean);
  const idFirst = idTokens[0] || "";
  const nameFirst = nameTokens[0] || "";
  if (idFirst.length >= 3 && idFirst === nameFirst) return true;
  if (firstNamesSimilar(idFirst, nameFirst)) {
    // First-name typo is enough when one side is first-name-only (Kaia "Andirius").
    // Both sides with last names must still agree on the last token.
    if (!hasDistinctLastName(idKey) || !hasDistinctLastName(nameKey)) return true;
    const idLast = idTokens[idTokens.length - 1] || "";
    const nameLast = nameTokens[nameTokens.length - 1] || "";
    if (idLast.length >= 3 && idLast === nameLast) return true;
    return false;
  }
  const idLast = idTokens[idTokens.length - 1] || "";
  const nameLast = nameTokens[nameTokens.length - 1] || "";
  if (idLast.length >= 3 && idLast === nameLast) return true;
  return false;
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
  if (firstNamesSimilar(token, localFirst)) return true;
  if (local === token) return true;
  // Token-bounded prefix only (matt.newman → "matt newman"). Bare
  // startsWith("matt") on "matthewn" is not last-name-aware; concatenations cover that.
  if (local.startsWith(`${token} `)) return true;
  if (emailLocalMatchesName(email, speakerLabel)) return true;
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
  if (emailA && emailB && emailA !== emailB) return false;

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
  if (emailA && labelB && speakerMatchesEmailLocal(labelB, emailA) && !isAmbiguousShortIdentityMatch(a, b)) {
    return true;
  }
  if (emailB && labelA && speakerMatchesEmailLocal(labelA, emailB) && !isAmbiguousShortIdentityMatch(a, b)) {
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
  // Typed/confirmed email is the stronger identity — keep that row's role rather than
  // leaving Primary SE + Customer on two cards (or letting a Kaia guess win).
  const typed = entries.find(
    (e) => (normalizeEmail(e.email) || /@/.test(identityLabel(e))) && e.role,
  );
  if (typed?.role) return typed.role;
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
  const aliasKeys = [
    ...new Set(
      entries.flatMap((e) =>
        [e.name, e.label, e.email, e.detail].map((v) => normalizePersonKey(v)).filter(Boolean),
      ),
    ),
  ];
  return {
    id,
    name: name || (email ? email.split("@")[0].replace(/[._-]+/g, " ") : "Attendee"),
    email,
    label,
    detail: email || label,
    role,
    manual,
    userAssignedRole,
    aliasKeys,
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
