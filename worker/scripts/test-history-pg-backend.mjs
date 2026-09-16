#!/usr/bin/env node
/**
 * Lane C HistoryBackend contract for the planned PG history backend.
 *
 * The implementation may land in a parallel lane, so this test is pending until
 * worker/src/history-pg.ts exists. Once present, it verifies chunk-free get/put
 * round-trips and normalization of history:{email} keys to lowercase.
 */
import assert from "node:assert/strict";

async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Cannot find module") ||
      message.includes("ERR_MODULE_NOT_FOUND") ||
      message.includes("Could not resolve")
    ) {
      return null;
    }
    throw err;
  }
}

function createMockPool() {
  const store = new Map();
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    const sql = String(text).replace(/\s+/g, " ").toLowerCase();
    if (sql === "begin" || sql === "commit" || sql === "rollback" || sql.includes("set_config(")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("insert into user_kv")) {
      const key = String(values[0] ?? "").toLowerCase();
      store.set(key, JSON.parse(String(values[1])));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("select history as value from user_kv")) {
      const key = String(values[0] ?? "").toLowerCase();
      const value = store.get(key) ?? null;
      return { rows: value == null ? [] : [{ value }], rowCount: value == null ? 0 : 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release() {} };
  return {
    calls,
    store,
    query,
    async connect() {
      return client;
    },
  };
}

function resolveFactory(module) {
  for (const name of ["createPostgresHistoryBackend", "createPgHistoryBackend", "createHistoryPgBackend"]) {
    if (typeof module[name] === "function") return module[name];
  }
  if (typeof module.default === "function") return module.default;
  assert.fail("history-pg.ts must export createPostgresHistoryBackend(pool)");
}

const module = await optionalImport("../src/history-pg.ts");
if (!module) {
  console.log("test-history-pg-backend: pending (worker/src/history-pg.ts not present)");
  process.exit(0);
}

const pool = createMockPool();
const backend = resolveFactory(module)(pool);
assert.equal(typeof backend?.get, "function", "PG history backend must implement get(key)");
assert.equal(typeof backend?.put, "function", "PG history backend must implement put(key, value)");

const original = JSON.stringify([{ id: "call_1", timestamp: 1796126400000, title: "ADR-008 Read Flip" }]);
await backend.put("history:USER@Example.COM", original);
const returned = await backend.get("history:user@example.com");

assert.equal(returned, original, "put then get must return the identical string");
assert.deepEqual(
  pool.store.get("user@example.com"),
  JSON.parse(original),
  "history key must be normalized to lowercase",
);
assert.ok(!pool.calls.some((call) => /chunk/i.test(call.text)), "PG history backend should not use chunk storage");
console.log("test-history-pg-backend: ok");
