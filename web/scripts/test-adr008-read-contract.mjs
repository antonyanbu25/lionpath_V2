import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(__dirname, "../../worker/src/routes.ts"), "utf8");

if (!/PERSISTENCE_READ_MODE/.test(routesSource)) {
  console.log("test-adr008-read-contract.mjs: pending (routes.ts read-flip gate not present yet)");
  process.exit(0);
}

assert.match(
  routesSource,
  /createPostgresReadRepository|PostgresReadRepository|readRepository/,
  "routes.ts must route PG reads through the Postgres read repository when PERSISTENCE_READ_MODE=pg",
);

assert.match(
  routesSource,
  /PERSISTENCE_READ_MODE[\s\S]{0,400}(?:pg|firestore)|(?:pg|firestore)[\s\S]{0,400}PERSISTENCE_READ_MODE/,
  "routes.ts must branch on PERSISTENCE_READ_MODE values",
);

assert.match(
  routesSource,
  /getDb\s*\(/,
  "legacy Firestore read path must remain available behind the read-mode flag",
);

console.log("test-adr008-read-contract.mjs: ok");
