import {
  resolveFishBucketType,
  parseFishMetricValue,
  fishBucketPlacement,
  fishBucketFromMetric,
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

if (process.exitCode) {
  console.error("\nFish sizing bucket tests failed.");
  process.exit(1);
}
console.log("\nFish sizing bucket tests passed.");
