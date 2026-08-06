/** Shared domain constants (no imports from auth to avoid cycles). */

export const DEMO_ORG_ID = "org_freshworks_se";
export const TEAM_AJAY_ID = "team_ajay";
export const TEAM_NIKIL_ID = "team_nikil";
export const TEAM_MARY_ID = "team_mary";
export const TEAM_VARUN_ID = "team_varun";
export const TEAM_AKSHITA_ID = "team_akshita";

export const SEG_NEW_BUSINESS_ID = "seg_new_business";
export const SEG_NURTURE_ID = "seg_nurture";
export const SEG_DIGITAL_ID = "seg_digital";

/** User-facing team labels (region + motion). Internal ids stay team_ajay / team_nikil. */
export const TEAM_NAME_INTERNATIONAL_NB = "International - NB";
export const TEAM_NAME_NORTH_AMERICA_NB = "North America - NB";

/** @type {Record<string, string>} */
export const TEAM_DISPLAY_NAMES = {
  [TEAM_AJAY_ID]: TEAM_NAME_INTERNATIONAL_NB,
  [TEAM_NIKIL_ID]: TEAM_NAME_NORTH_AMERICA_NB,
  [TEAM_MARY_ID]: "Mary — Nurture",
  [TEAM_VARUN_ID]: "Varun — Nurture",
  [TEAM_AKSHITA_ID]: "Digital",
};

/** @type {Record<string, string>} */
export const SEGMENT_DISPLAY_NAMES = {
  [SEG_NEW_BUSINESS_ID]: "New Business",
  [SEG_NURTURE_ID]: "Nurture",
  [SEG_DIGITAL_ID]: "Digital",
};

/** @param {string|null|undefined} teamId */
export function teamDisplayName(teamId) {
  if (!teamId) return null;
  return TEAM_DISPLAY_NAMES[teamId] || null;
}

/** All org team ids in the Freshworks CX SE org. */
export const ORG_TEAM_IDS = [
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_MARY_ID,
  TEAM_VARUN_ID,
  TEAM_AKSHITA_ID,
];

/** Segment → team ids (leader emails resolved at seed time). */
export const ORG_SEGMENT_DEFS = [
  {
    id: SEG_NEW_BUSINESS_ID,
    name: SEGMENT_DISPLAY_NAMES[SEG_NEW_BUSINESS_ID],
    leaderEmail: "antony.sagayaraj@freshworks.com",
    teamIds: [TEAM_AJAY_ID, TEAM_NIKIL_ID],
  },
  {
    id: SEG_NURTURE_ID,
    name: SEGMENT_DISPLAY_NAMES[SEG_NURTURE_ID],
    leaderEmail: "preethi.sriram@freshworks.com",
    teamIds: [TEAM_MARY_ID, TEAM_VARUN_ID],
  },
  {
    id: SEG_DIGITAL_ID,
    name: SEGMENT_DISPLAY_NAMES[SEG_DIGITAL_ID],
    leaderEmail: "preethi.sri@freshworks.com",
    teamIds: [TEAM_AKSHITA_ID],
  },
];

/** @deprecated Use TEAM_AJAY_ID. kept for imports during transition */
export const TEAM_ANTONY_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_A_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_ID = TEAM_AJAY_ID;
/** @deprecated Replaced by TEAM_MARY_ID / TEAM_AKSHITA_ID */
export const TEAM_PREETHI_SRI_ID = TEAM_AKSHITA_ID;
/** @deprecated Replaced by TEAM_MARY_ID / TEAM_VARUN_ID */
export const TEAM_PREETHI_SRIRAM_ID = TEAM_MARY_ID;

/** Consumer / webmail domains. must not become account slugs or stored account domains. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.in",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "rediffmail.com",
  "qq.com",
  "163.com",
]);

/** @param {string|null|undefined} domain */
export function isFreeMailDomain(domain) {
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split("/")[0];
  return d ? FREE_MAIL_DOMAINS.has(d) : false;
}

/** Map team id → segment id from ORG_SEGMENT_DEFS. */
export function segmentIdForTeamId(teamId) {
  if (!teamId) return null;
  for (const seg of ORG_SEGMENT_DEFS) {
    if (seg.teamIds.includes(teamId)) return seg.id;
  }
  return null;
}
