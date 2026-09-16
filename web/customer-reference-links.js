/** Industry → Seismic customer reference deck URLs (public, not secrets). */

const SEISMIC_DOC_CENTER =
  "https://freshworks.seismic.com/apps/doccenter/ce082912-90f6-4d06-902f-a0b7b732d2aa/main/%25252Fdded24ddda-6c75-4135-b8ea-e9dd4c2b7a2e%25252F";

export const CUSTOMER_REFERENCE_BY_INDUSTRY = {
  bfsi: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CQkZTSQ%25253D%25253D//`,
  education: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CRWR1Y2F0aW9uL0VkdXRlY2g%25253D//`,
  generalB2b: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CR2VuZXJhbCBCMkI%25253D//`,
  generalB2c: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CR2VuZXJhbCBCMkM%25253D//`,
  highTechB2b: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CSGlnaCBUZWNoIEIyQg%25253D%25253D//`,
  highTechB2c: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CSGlnaCBUZWNoIEIyQw%25253D%25253D//`,
  logistics: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CTG9naXN0aWNz//`,
  manufacturing: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CTWFudWZhY3R1cmluZw%25253D%25253D//`,
  realEstate: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CUmVhbCBFc3RhdGU%25253D//`,
  ecommerce: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CUmV0YWlsL2VDb21tZXJjZQ%25253D%25253D//`,
  professionalServices: `${SEISMIC_DOC_CENTER}dfNjYwMGE3MDItMzQ0MC00ZDljLWI0MGMtYWNiNTcwM2JjOTc2%25252CPT0%25253D%25252CUHJvZmVzc2lvbmFsIFNlcnZpY2Vz//`,
};

export const DEFAULT_CUSTOMER_REFERENCE_INDUSTRY = "generalB2b";

/** @type {Array<{ id: keyof typeof CUSTOMER_REFERENCE_BY_INDUSTRY, test: (text: string) => boolean }>} */
const INDUSTRY_MATCHERS = [
  {
    id: "bfsi",
    test: (t) =>
      /\b(bfsi|banking|bank|financial services|insurance|wealth management|capital markets)\b/.test(t) ||
      /\bfintech\b/.test(t),
  },
  {
    id: "education",
    test: (t) =>
      /\b(education|edutech|edtech|university|school|college|learning platform|elearning|e-learning)\b/.test(t),
  },
  {
    id: "logistics",
    test: (t) =>
      /\b(logistics|logistic|shipping|freight|supply chain|warehousing|last mile|3pl|courier)\b/.test(t),
  },
  {
    id: "manufacturing",
    test: (t) => /\b(manufacturing|manufacturer|industrial|factory|fabrication|production plant)\b/.test(t),
  },
  {
    id: "realEstate",
    test: (t) => /\b(real estate|property management|proptech|realtor|housing developer)\b/.test(t),
  },
  {
    id: "ecommerce",
    test: (t) =>
      /\b(ecommerce|e-commerce|e commerce|online retail|marketplace|d2c brand|direct to consumer retail)\b/.test(t) ||
      /\bretail\b/.test(t),
  },
  {
    id: "professionalServices",
    test: (t) =>
      /\b(professional services|consulting firm|management consulting|legal services|accounting firm|law firm)\b/.test(t),
  },
  {
    id: "highTechB2c",
    test: (t) =>
      /\b(b2c saas|saas b2c|consumer app|consumer software|b2c software|tech b2c|high tech b2c)\b/.test(t) ||
      (/\b(saas|software|platform|cloud)\b/.test(t) && /\b(b2c|consumer|d2c)\b/.test(t)),
  },
  {
    id: "highTechB2b",
    test: (t) =>
      /\b(b2b saas|saas b2b|b2b software|software platform|enterprise software|cloud platform|high tech b2b)\b/.test(t) ||
      (/\b(saas|software|platform|cloud|technology|tech)\b/.test(t) && /\bb2b\b/.test(t)) ||
      /\bsaas\b/.test(t),
  },
  {
    id: "generalB2c",
    test: (t) => /\b(b2c|consumer|d2c|direct to consumer)\b/.test(t),
  },
];

function normalizeIndustryText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^\w\s/&-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Collect industry hints from prep brief fields (most specific first). */
export function gatherIndustryText(prep) {
  const parts = [];

  for (const fact of prep?.facts || []) {
    const key = String(fact?.key || "").trim();
    if (/^industry$/i.test(key)) parts.push(fact.value);
  }

  const bc = prep?.businessContext || {};
  parts.push(bc.market, bc.model, bc.users);

  parts.push(prep?.description, prep?.about);

  for (const row of prep?.fitSnapshot || []) {
    parts.push(row.label, row.thisCompany, row.industryNorm);
  }

  for (const row of prep?.industryUseCases || []) {
    parts.push(typeof row === "string" ? row : row?.name);
  }

  for (const pain of prep?.likelyPains || []) parts.push(pain);

  return normalizeIndustryText(parts.filter(Boolean).join(" "));
}

/** Resolve canonical industry bucket id from prep brief signals. */
export function resolveCustomerReferenceIndustry(prep) {
  for (const fact of prep?.facts || []) {
    const key = String(fact?.key || "").trim();
    if (!/^industry$/i.test(key)) continue;
    const factText = normalizeIndustryText(fact.value);
    if (!factText || factText === "unknown") continue;
    for (const { id, test } of INDUSTRY_MATCHERS) {
      if (test(factText)) return id;
    }
  }

  const text = gatherIndustryText(prep);
  if (!text) return DEFAULT_CUSTOMER_REFERENCE_INDUSTRY;

  for (const { id, test } of INDUSTRY_MATCHERS) {
    if (test(text)) return id;
  }

  return DEFAULT_CUSTOMER_REFERENCE_INDUSTRY;
}

/** Seismic customer reference URL for this prep brief. */
export function resolveCustomerReferenceUrl(prep) {
  const industryId = resolveCustomerReferenceIndustry(prep);
  return (
    CUSTOMER_REFERENCE_BY_INDUSTRY[industryId] ||
    CUSTOMER_REFERENCE_BY_INDUSTRY[DEFAULT_CUSTOMER_REFERENCE_INDUSTRY]
  );
}
