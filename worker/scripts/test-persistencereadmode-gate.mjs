import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const routesSource = readFileSync(join(root, "src/routes.ts"), "utf8");
const domainReadsSource = readFileSync(join(root, "src/routes/domain-reads.ts"), "utf8");
const nodeServerSource = readFileSync(join(root, "src/node-server.ts"), "utf8");

assert.match(
  routesSource,
  /persistenceReadReady/,
  "routes.ts must import/use persistenceReadReady for opt-in PG domain reads",
);
assert.match(
  routesSource,
  /createPostgresReadRepository/,
  "routes.ts must import/use createPostgresReadRepository for opt-in PG domain reads",
);
assert.match(
  domainReadsSource,
  /persistenceReadReady/,
  "domain read handlers must gate PG reads with persistenceReadReady",
);
assert.match(
  domainReadsSource,
  /createPostgresReadRepository/,
  "domain read handlers must construct the Postgres read repository",
);
assert.match(
  domainReadsSource,
  /repo\s*\?\s*await repo\.listCallSummariesForScope[\s\S]*:\s*await listCallSummariesForScope/,
  "calls list must keep the Firestore read path as the fallback",
);
assert.match(
  domainReadsSource,
  /repo\s*\?\s*await repo\.listDealsForScope[\s\S]*:\s*await listDealsForScope/,
  "deals list must keep the Firestore read path as the fallback",
);
assert.match(
  nodeServerSource,
  /PERSISTENCE_READ_MODE:\s*process\.env\.PERSISTENCE_READ_MODE\s*\|\|\s*""/,
  "node-server.ts must thread PERSISTENCE_READ_MODE without enabling PG by default",
);
assert.match(
  nodeServerSource,
  /HISTORY_BACKEND_MODE:\s*process\.env\.HISTORY_BACKEND_MODE\s*\|\|\s*""/,
  "node-server.ts must thread HISTORY_BACKEND_MODE without enabling PG by default",
);
assert.match(
  nodeServerSource,
  /historyBackendMode\s*===\s*"pg"[\s\S]*postgresReady/,
  "node-server.ts must gate PG history/tasks backend selection on pg mode and postgres readiness",
);

console.log("test-persistencereadmode-gate.mjs: ok");
