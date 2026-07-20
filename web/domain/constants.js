/** Shared domain constants (no imports from auth to avoid cycles). */

export const DEMO_ORG_ID = "org_freshworks_se";
export const TEAM_AJAY_ID = "team_ajay";
export const TEAM_NIKIL_ID = "team_nikil";
export const TEAM_PREETHI_SRI_ID = "team_preethi_sri";
export const TEAM_PREETHI_SRIRAM_ID = "team_preethi_sriram";

/** All squad team ids in the Freshworks CX SE org. */
export const SQUAD_TEAM_IDS = [
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_PREETHI_SRI_ID,
  TEAM_PREETHI_SRIRAM_ID,
];

/** @deprecated Use TEAM_AJAY_ID — kept for imports during transition */
export const TEAM_ANTONY_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_A_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_ID = TEAM_AJAY_ID;
