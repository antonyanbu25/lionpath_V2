/**
 * PostgreSQL-backed history KV.
 *
 * Maps existing keys (`history:{email}`, `tasks:{email}`, `feedback:{email}`)
 * onto user_kv JSONB columns while preserving the HistoryBackend contract.
 */

import type { HistoryBackend } from "./history";
import { normalizeHistoryEmail } from "./history";
import type { PgPool } from "./data/persistence/postgres-pool";

type UserKvColumn = "history" | "tasks" | "feedback";

const KEY_PATTERN = /^(history|tasks|feedback):(.+)$/;
const GLOBAL_FEEDBACK_EMAIL = "__global__";

interface ParsedKey {
  column: UserKvColumn;
  email: string;
}

function parseKey(key: string): ParsedKey {
  const match = KEY_PATTERN.exec(String(key || ""));
  if (!match) {
    throw new Error(`Unsupported PG history key: ${key}`);
  }

  const column = match[1] as UserKvColumn;
  const rawEmail = match[2];
  const email =
    column === "feedback" && rawEmail === "global"
      ? GLOBAL_FEEDBACK_EMAIL
      : normalizeHistoryEmail(rawEmail);

  if (!email) {
    throw new Error(`PG history key is missing an email: ${key}`);
  }

  return { column, email };
}

function parseJsonBlob(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("PG history backend only accepts JSON string blobs.");
  }
}

function stringifyJsonBlob(value: unknown): string {
  return JSON.stringify(value);
}

async function withEmail<T>(
  pool: PgPool,
  email: string,
  fn: (query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.email', $1, true)", [email]);
    const result = await fn((sql, params = []) => client.query(sql, params));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}

export function createPostgresHistoryBackend(pool: PgPool): HistoryBackend {
  const backend = {
    name: "PostgresHistoryBackend",
    async get(key: string): Promise<string | null> {
      const { column, email } = parseKey(key);
      return withEmail(pool, email, async (query) => {
        const result = (await query(`SELECT ${column} AS value FROM user_kv WHERE email = $1`, [
          email,
        ])) as { rows: Array<{ value: unknown }> };
        const value = result.rows[0]?.value;
        return value == null ? null : stringifyJsonBlob(value);
      });
    },
    async put(key: string, value: string): Promise<void> {
      const { column, email } = parseKey(key);
      const json = parseJsonBlob(value);
      await withEmail(pool, email, async (query) => {
        await query(
          `INSERT INTO user_kv (email, ${column}, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (email) DO UPDATE
           SET ${column} = EXCLUDED.${column},
               updated_at = now()`,
          [email, JSON.stringify(json)],
        );
      });
    },
  };
  return backend;
}

export const __private__ = { parseKey };
