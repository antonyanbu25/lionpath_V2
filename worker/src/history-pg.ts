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
type UserKvStorageColumn = UserKvColumn | "sidecar";

const KEY_PATTERN = /^(history|tasks|feedback):(.+)$|^recovery:sidecar:([A-Za-z]+):(.+)$/;
const GLOBAL_FEEDBACK_EMAIL = "__global__";
const USER_KV_COLUMNS = new Set<UserKvColumn>(["history", "tasks", "feedback"]);

interface ParsedKey {
  column: UserKvStorageColumn;
  email: string;
  kind?: string;
}

function parseKey(key: string): ParsedKey {
  const match = KEY_PATTERN.exec(String(key || ""));
  if (!match) {
    throw new Error(`Unsupported PG history key: ${key}`);
  }

  if (match[3]) {
    const kind = match[3];
    const email = normalizeHistoryEmail(match[4]);
    if (!email) {
      throw new Error(`PG history key is missing an email: ${key}`);
    }
    return { column: "sidecar", email, kind };
  }

  const column = match[1] as UserKvColumn;
  if (!USER_KV_COLUMNS.has(column)) {
    throw new Error(`Unsupported PG history column: ${column}`);
  }
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
      const { column, email, kind } = parseKey(key);
      return withEmail(pool, email, async (query) => {
        if (column === "sidecar") {
          const result = (await query("SELECT sidecar -> $2 AS value FROM user_kv WHERE email = $1", [
            email,
            kind,
          ])) as { rows: Array<{ value: unknown }> };
          const value = result.rows[0]?.value;
          return value == null ? null : stringifyJsonBlob(value);
        }

        const result = (await query(`SELECT ${column} AS value FROM user_kv WHERE email = $1`, [
          email,
        ])) as { rows: Array<{ value: unknown }> };
        const value = result.rows[0]?.value;
        return value == null ? null : stringifyJsonBlob(value);
      });
    },
    async put(key: string, value: string): Promise<void> {
      const { column, email, kind } = parseKey(key);
      const json = parseJsonBlob(value);
      await withEmail(pool, email, async (query) => {
        if (column === "sidecar") {
          await query(
            `INSERT INTO user_kv (email, sidecar, updated_at)
             VALUES ($1, jsonb_set('{}'::jsonb, ARRAY[$3::text], $2::jsonb, true), now())
             ON CONFLICT (email) DO UPDATE
             SET sidecar = jsonb_set(
                   COALESCE(user_kv.sidecar, '{}'::jsonb),
                   ARRAY[$3::text],
                   $2::jsonb,
                   true
                 ),
                 updated_at = now()`,
            [email, JSON.stringify(json), kind],
          );
          return;
        }

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
    /**
     * Atomic upsert-by-id into a user_kv list column, newest first, trimmed.
     *
     * One statement, so two concurrent callers serialise on the row lock and
     * each sees the other's entry — which is the whole point. The JS
     * read-modify-write it replaces lost one of two concurrent entries
     * (H1/J-031).
     *
     * Semantics match the JS version exactly so behaviour does not change:
     *   - an entry with an existing id REPLACES it rather than duplicating;
     *   - the new entry goes to the FRONT (newest first);
     *   - the list is trimmed to `max` AFTER the splice, not before.
     *
     * Only the three plain list columns are supported. `sidecar` is an object
     * keyed by kind, not a list, and has no id-based identity to splice on.
     */
    async upsertListEntry(key: string, entryJson: string, max: number): Promise<string> {
      const { column, email } = parseKey(key);
      if (column === "sidecar") {
        throw new Error("upsertListEntry does not apply to the sidecar column.");
      }
      const entry = parseJsonBlob(entryJson);
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("upsertListEntry expects a single JSON object entry.");
      }
      return withEmail(pool, email, async (query) => {
        const result = (await query(
          `INSERT INTO user_kv (email, ${column}, updated_at)
           VALUES ($1, jsonb_build_array($2::jsonb), now())
           ON CONFLICT (email) DO UPDATE
           SET ${column} = (
                 SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
                   FROM (
                     SELECT e, ord FROM (
                       -- ord 0 puts the incoming entry first; existing entries
                       -- keep their relative order from 1 upward.
                       SELECT $2::jsonb AS e, 0::bigint AS ord
                       UNION ALL
                       SELECT elem, ord
                         FROM jsonb_array_elements(
                                COALESCE(user_kv.${column}, '[]'::jsonb)
                              ) WITH ORDINALITY AS t(elem, ord)
                        -- IS DISTINCT FROM, not <>: an entry with no id must
                        -- survive rather than be silently dropped by a NULL
                        -- comparison.
                        WHERE elem->>'id' IS DISTINCT FROM ($2::jsonb->>'id')
                     ) unioned
                     ORDER BY ord
                     LIMIT $3
                   ) trimmed
               ),
               updated_at = now()
           RETURNING ${column} AS value`,
          [email, JSON.stringify(entry), max],
        )) as { rows: Array<{ value: unknown }> };
        const value = result.rows[0]?.value;
        return value == null ? "[]" : stringifyJsonBlob(value);
      });
    },
  };
  return backend;
}

export const __private__ = { parseKey };
