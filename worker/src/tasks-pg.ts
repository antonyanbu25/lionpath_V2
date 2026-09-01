/**
 * PostgreSQL-backed tasks KV.
 *
 * Tasks share the same HistoryBackend interface and user_kv table as history.
 */

import type { HistoryBackend } from "./history";
import { createPostgresHistoryBackend } from "./history-pg";
import type { PgPool } from "./data/persistence/postgres-pool";

export function createPostgresTasksBackend(pool: PgPool): HistoryBackend {
  const backend = {
    ...createPostgresHistoryBackend(pool),
    name: "PostgresTasksBackend",
  };
  return backend;
}
