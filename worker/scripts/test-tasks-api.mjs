/** Smoke test for /api/tasks GET + POST + PATCH against local worker. */

const BASE = process.env.WORKER_URL || "http://127.0.0.1:8787";
const EMAIL = "se-test-tasks@freshworks.com";

const task = {
  id: `task-${Date.now()}`,
  title: "Worker task API test",
  status: "pending",
  source: "manual",
  createdAt: Date.now(),
};

const postRes = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, task }),
});
const postBody = await postRes.json();
if (!postRes.ok) {
  console.error("POST failed:", postBody);
  process.exit(1);
}

const getRes = await fetch(`${BASE}/api/tasks?email=${encodeURIComponent(EMAIL)}`);
const getBody = await getRes.json();
if (!getRes.ok) {
  console.error("GET failed:", getBody);
  process.exit(1);
}

const found = (getBody.tasks || []).some((t) => t.id === task.id);
if (!found) {
  console.error("FAILED: saved task not returned by GET");
  process.exit(1);
}

const patchRes = await fetch(`${BASE}/api/tasks/${encodeURIComponent(task.id)}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, status: "completed", completedAt: Date.now() }),
});
const patchBody = await patchRes.json();
if (!patchRes.ok || patchBody.task?.status !== "completed") {
  console.error("PATCH failed:", patchBody);
  process.exit(1);
}

console.log(`OK — tasks API round-trip for ${EMAIL} (${getBody.tasks.length} tasks)`);
