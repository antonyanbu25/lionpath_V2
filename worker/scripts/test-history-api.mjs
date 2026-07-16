/** Smoke test for /api/history GET + POST against local worker. */

const BASE = process.env.WORKER_URL || "http://127.0.0.1:8787";
const EMAIL = "se-test@freshworks.com";

const entry = {
  id: `test-${Date.now()}`,
  timestamp: Date.now(),
  title: "Worker API test",
  analysis: { callSummary: { headline: "Worker API test" } },
};

const postRes = await fetch(`${BASE}/api/history`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, entry }),
});
const postBody = await postRes.json();
if (!postRes.ok) {
  console.error("POST failed:", postBody);
  process.exit(1);
}

const getRes = await fetch(`${BASE}/api/history?email=${encodeURIComponent(EMAIL)}`);
const getBody = await getRes.json();
if (!getRes.ok) {
  console.error("GET failed:", getBody);
  process.exit(1);
}

const found = (getBody.entries || []).some((e) => e.id === entry.id);
if (!found) {
  console.error("FAILED: saved entry not returned by GET");
  process.exit(1);
}

console.log(`OK — history API round-trip for ${EMAIL} (${getBody.entries.length} entries)`);
