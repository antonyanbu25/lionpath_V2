import {
  resolveFishBucketType,
  parseFishMetricValue,
  fishBucketPlacement,
  fishBucketFromMetric,
  normalizeFishSizingMetrics,
  formatFishSizingDisplay,
} from "../fish-sizing-buckets.js";

function assert(name, ok) {
  if (!ok) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("ok:", name);
  }
}

// Label resolution
assert("employees label", resolveFishBucketType("Employees") === "employees");
assert("funding label", resolveFishBucketType("Funding raised") === "funding");
assert("support agents label", resolveFishBucketType("Support agents") === "supportAgents");
assert("unknown label", resolveFishBucketType("Customer base") === null);

// Parse cases
assert("parse 50", parseFishMetricValue("50") === 50);
assert("parse 2 Million", parseFishMetricValue("2 Million") === 2_000_000);
assert("parse 3", parseFishMetricValue("3") === 3);
assert("parse 120 agents", parseFishMetricValue("120 agents") === 120);

// Employees buckets
assert("50 employees bucket 0", fishBucketFromMetric("Employees", "50").bucketIndex === 0);
assert("50 employees dot ~16.7%", Math.abs(fishBucketFromMetric("Employees", "50").dotPercent - 16.666666666666668) < 0.01);
assert("250 employees bucket 1", fishBucketFromMetric("Employees", "250").bucketIndex === 1);
assert("251 employees bucket 2", fishBucketFromMetric("Employees", "251").bucketIndex === 2);

// Funding buckets (millions USD)
const funding2M = fishBucketFromMetric("Funding", "2 Million");
assert("2 Million funding bucket 1", funding2M.bucketIndex === 1);
assert("2 Million funding dot ~50%", Math.abs(funding2M.dotPercent - 50) < 0.01);

// Support agents buckets
assert("3 agents bucket 0", fishBucketFromMetric("Support agents", "3").bucketIndex === 0);
const agents120 = fishBucketFromMetric("Support agents", "120 agents");
assert("120 agents bucket 2", agents120.bucketIndex === 2);
assert("120 agents dot ~83.3%", Math.abs(agents120.dotPercent - 83.33333333333333) < 0.01);

// Boundary: support agents at 25 → first bucket
assert("25 agents bucket 0", fishBucketFromMetric("Support agents", "25").bucketIndex === 0);
assert("26 agents bucket 1", fishBucketFromMetric("Support agents", "26").bucketIndex === 1);
assert("100 agents bucket 1", fishBucketFromMetric("Support agents", "100").bucketIndex === 1);
assert("101 agents bucket 2", fishBucketFromMetric("Support agents", "101").bucketIndex === 2);

// fishBucketPlacement labels
const empPlacement = fishBucketPlacement("employees", 50);
assert("employees labels", empPlacement.labels.join(",") === "0–50,50–250,>250");

const fundingPlacement = fishBucketPlacement("funding", 2_000_000);
assert("funding bucket labels include M", fundingPlacement.labels.join(",") === "$0–1M,$1–10M,>$10M");

assert("format employees", formatFishSizingDisplay("employees", "50") === "50");
assert("format agents strips suffix", formatFishSizingDisplay("supportAgents", "3 agents") === "3");
assert("format funding 2 million", formatFishSizingDisplay("funding", "2 Million") === "$2M");
assert("format funding lowercase", formatFishSizingDisplay("funding", "2 million") === "$2M");
assert("format funding 80M series", formatFishSizingDisplay("funding", "$80M Series C") === "$80M");
assert("agents reject 4 trillion as 4", parseFishMetricValue("4 trillion", "supportAgents") === 4);
assert("agents reject raw 4e12", parseFishMetricValue("4000000000000", "supportAgents") === null);
assert("agents reject 8 billion", parseFishMetricValue("8 billion agents", "supportAgents") === 8);
assert("agents 8B strips billion suffix", parseFishMetricValue("8B", "supportAgents") === 8);
assert("format agents 4 trillion shows 4", formatFishSizingDisplay("supportAgents", "4 trillion") === "4");
assert("format agents absurd shows dash", formatFishSizingDisplay("supportAgents", "4000000000000") === "—");
assert(
  "normalize drops absurd agent count",
  normalizeFishSizingMetrics([{ label: "Support agents", value: "4000000000000" }]).length === 0,
);

const normalized = normalizeFishSizingMetrics([
  { label: "Employees", value: "50" },
  { label: "Industry", value: "Software licenses" },
  { label: "Support agents", value: "3 agents" },
  { label: "Funding raised", value: "2 Million" },
]);
assert("normalize drops industry", normalized.length === 3);
assert("normalize order employees first", normalized[0].label === "Employee count");
assert("normalize agent count label", normalized[1].label === "Agent count");
assert("normalize funding label", normalized[2].label === "Funding");
assert("agent count bucket type", resolveFishBucketType("Agent count") === "supportAgents");
assert("employee count bucket type", resolveFishBucketType("Employee count") === "employees");

if (process.exitCode) {
  console.error("\nFish sizing bucket tests failed.");
  process.exit(1);
}
console.log("\nFish sizing bucket tests passed.");
