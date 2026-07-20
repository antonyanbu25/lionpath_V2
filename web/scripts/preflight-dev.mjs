/**
 * Preflight before manual QA — verifies dev servers are reachable on 8788/8787.
 * Exit 0 = ready; exit 1 = start worker + web first.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_PORT = Number(process.env.WEB_PORT || 8788);
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { reachable: true, ok: res.ok, status: res.status };
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    const refused = code === "ECONNREFUSED" || String(err?.message || "").includes("ECONNREFUSED");
    return { reachable: false, error: code || err?.message || "failed", refused };
  }
}

const webUrl = `http://${HOST}:${WEB_PORT}/`;
const workerUrl = `http://${HOST}:${WORKER_PORT}/`;

const [web, worker] = await Promise.all([probe(webUrl), probe(workerUrl)]);

const issues = [];
if (!web.reachable || !web.ok) {
  issues.push(`Web UI not reachable at ${webUrl} (${web.error || `HTTP ${web.status}`})`);
  issues.push("  → cd V2/singapaathai/web && npm run dev");
}
if (!worker.reachable) {
  issues.push(`Worker API not reachable at ${workerUrl} (${worker.error || "connection refused"})`);
  issues.push("  → cd V2/singapaathai/worker && npm run dev");
}

if (issues.length) {
  console.error("Preflight FAILED — dev servers not running:\n");
  for (const line of issues) console.error(line);
  console.error("\nOpen http://localhost:8788 after both are up (not 8787).");
  process.exit(1);
}

if (web.ok) {
  const html = await (await fetch(webUrl)).text();
  if (!html.includes('data-view="accounts"')) {
    console.error("Preflight FAILED: served index.html missing Accounts nav");
    process.exit(1);
  }
}

console.log(`Preflight OK — web :${WEB_PORT}, worker :${WORKER_PORT}`);
