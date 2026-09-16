import {
  resolveCustomerReferenceIndustry,
  resolveCustomerReferenceUrl,
  CUSTOMER_REFERENCE_BY_INDUSTRY,
  DEFAULT_CUSTOMER_REFERENCE_INDUSTRY,
} from "../customer-reference-links.js";

const manufacturingPrep = {
  description: "Commercial door manufacturer",
  facts: [{ key: "Industry", value: "Manufacturing" }],
  businessContext: { market: "Manufacturing", model: "B2B direct" },
};

const saasPrep = {
  description: "B2B SaaS customer support platform",
  facts: [{ key: "Industry", value: "Software" }],
  businessContext: { market: "Technology", model: "B2B SaaS subscription" },
};

const unknownPrep = {
  description: "Regional services company",
  facts: [{ key: "Head office", value: "Austin, TX" }],
  businessContext: { market: "unknown", model: "unknown" },
};

const checks = [
  [
    "manufacturing maps to manufacturing",
    resolveCustomerReferenceIndustry(manufacturingPrep) === "manufacturing",
  ],
  [
    "saas maps to high tech b2b",
    resolveCustomerReferenceIndustry(saasPrep) === "highTechB2b",
  ],
  [
    "unknown defaults to general b2b",
    resolveCustomerReferenceIndustry(unknownPrep) === DEFAULT_CUSTOMER_REFERENCE_INDUSTRY,
  ],
  [
    "manufacturing url is seismic",
    resolveCustomerReferenceUrl(manufacturingPrep) === CUSTOMER_REFERENCE_BY_INDUSTRY.manufacturing,
  ],
  [
    "all industry urls are seismic doccenter",
    Object.values(CUSTOMER_REFERENCE_BY_INDUSTRY).every((url) => url.includes("freshworks.seismic.com/apps/doccenter")),
  ],
  [
    "education keyword matches",
    resolveCustomerReferenceIndustry({ facts: [{ key: "Industry", value: "Edutech" }] }) === "education",
  ],
  [
    "bfsi keyword matches",
    resolveCustomerReferenceIndustry({ facts: [{ key: "Industry", value: "Banking / BFSI" }] }) === "bfsi",
  ],
  [
    "explicit industry fact wins over about text",
    resolveCustomerReferenceIndustry({
      facts: [{ key: "Industry", value: "Manufacturing" }],
      about: "Supplies products to education facilities",
    }) === "manufacturing",
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} customer reference link checks passed.`);
