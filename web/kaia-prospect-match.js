/**
 * Browser mirror of worker/src/kaia/matchProspectExcerpt.ts (keep in sync).
 */

const ENRICH_LIMIT_KAIA = 12_000;

function normalizeToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return normalizeToken(s).split(/\s+/).filter(Boolean);
}

function emailLocalPart(email) {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(0, at).toLowerCase() : email.toLowerCase();
}

export function prospectMatchesSpeaker(email, hintName, speakerName) {
  const speakerNorm = normalizeToken(speakerName);
  if (!speakerNorm) return false;

  const local = emailLocalPart(email).replace(/[._-]/g, " ");
  const localTokens = tokens(local);
  const speakerToks = tokens(speakerName);

  if (local && (speakerNorm.includes(normalizeToken(local)) || normalizeToken(local).includes(speakerNorm))) {
    return true;
  }

  for (const lt of localTokens) {
    if (lt.length >= 3 && speakerToks.some((st) => st === lt || st.startsWith(lt) || lt.startsWith(st))) {
      return true;
    }
  }

  const hint = hintName?.trim();
  if (hint) {
    const hintToks = tokens(hint);
    const overlap = hintToks.filter((t) => t.length >= 2 && speakerToks.includes(t));
    if (overlap.length >= 1 && overlap.length >= Math.min(2, hintToks.length)) return true;
    if (hintToks.length === 1 && speakerToks.includes(hintToks[0])) return true;
  }

  return false;
}

function formatKaiaMetadataHeader(bundle) {
  const parts = [];
  if (bundle.title) parts.push(`Meeting: ${bundle.title}`);
  if (bundle.startTime) parts.push(`Date: ${bundle.startTime}`);
  if (bundle.participants?.length) {
    parts.push(`Participants: ${bundle.participants.map((p) => p.displayName).join(", ")}`);
  }
  return parts.join(" | ");
}

function parseSummaryBlocks(summaryJson) {
  if (!summaryJson?.trim()) return [];
  try {
    const blocks = JSON.parse(summaryJson);
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

function extractOutcome(blocks) {
  for (const block of blocks) {
    const name = (block.name || block.type || "").toLowerCase();
    if (name.includes("outcome")) {
      return block.result?.stringOutput?.trim() || "";
    }
  }
  return "";
}

function extractMatchedSpeakerSections(blocks, email, hintName) {
  const sections = [];
  for (const block of blocks) {
    const lists = block.result?.listKeyPoints;
    if (!lists?.length) continue;
    for (const section of lists) {
      const matchedPoints = [];
      for (const pt of section.points || []) {
        const speakers = (pt.sources || []).map((s) => s.speaker?.name || "").filter(Boolean);
        if (speakers.some((sp) => prospectMatchesSpeaker(email, hintName, sp))) {
          if (pt.text?.trim()) matchedPoints.push(`- ${pt.text.trim()}`);
        }
      }
      if (matchedPoints.length) {
        sections.push([section.title, ...matchedPoints].filter(Boolean).join("\n"));
      }
    }
  }
  return sections;
}

export function matchProspectKaiaExcerpt({ email, hintName, bundle }) {
  const header = formatKaiaMetadataHeader(bundle);
  const blocks = parseSummaryBlocks(bundle.summaryJson);
  const outcome = extractOutcome(blocks);
  const speakerSections = extractMatchedSpeakerSections(blocks, email, hintName);

  const parts = [];
  if (header) parts.push(header);
  if (outcome) parts.push(`Outcome:\n${outcome.slice(0, 2000)}`);

  if (speakerSections.length) {
    parts.push("Speaker-specific segments:\n" + speakerSections.join("\n\n"));
  } else if (bundle.summary) {
    parts.push(
      "No speaker-specific Kaia segments matched this email; using meeting-level summary.\n\n" + bundle.summary,
    );
  }

  return parts.join("\n\n").trim().slice(0, ENRICH_LIMIT_KAIA);
}
