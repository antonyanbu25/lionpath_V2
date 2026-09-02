#!/usr/bin/env node
/**
 * Dedupe orphaned post-call history blob entries.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node worker/scripts/dedupe-history-blob.mjs --email user@example.com --dry-run
 *   DATABASE_URL=postgresql://... node worker/scripts/dedupe-history-blob.mjs --email user@example.com --apply
 */

import pg from "pg";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

function parseArgs(argv) {
  const args = { email: "", dryRun: false, apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") {
      args.email = String(argv[++i] || "");
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.apply) args.dryRun = true;
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node worker/scripts/dedupe-history-blob.mjs --email user@example.com --dry-run",
    "  node worker/scripts/dedupe-history-blob.mjs --email user@example.com --apply",
  ].join("\n");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalZoomLink(entry) {
  const zoom = String(entry?.zoomLink || entry?.result?.recordingUrl || "").trim();
  if (!zoom) return "";
  const shareMatch = zoom.match(/\/rec\/(?:share|play)\/([^/?#]+)/i);
  if (shareMatch) return `zoom:${shareMatch[1].toLowerCase()}`;
  const recordingMatch = zoom.match(/recording[=/]([a-zA-Z0-9_-]+)/i);
  if (recordingMatch) return `zoom:${recordingMatch[1].toLowerCase()}`;
  return `zoomurl:${zoom.split("?")[0].trim().toLowerCase()}`;
}

function wordCount(entry) {
  const candidates = [
    entry?.wordCount,
    entry?.transcriptMeta?.wordCount,
    entry?.result?.wordCount,
    entry?.result?.transcriptMeta?.wordCount,
    entry?.analysis?.transcriptMeta?.wordCount,
    entry?.analysis?.callHeader?.wordCount,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  }
  return null;
}

function duplicateSignature(entry) {
  const zoom = canonicalZoomLink(entry);
  const title = normalizeText(entry?.title || entry?.analysis?.callHeader?.title);
  const words = wordCount(entry);
  return `${zoom}|title:${title}|words:${words ?? "unknown"}`;
}

function timestampValue(entry) {
  const numeric = Number(entry?.timestamp ?? entry?.createdAt ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function fmtTime(entry) {
  const ts = timestampValue(entry);
  if (!ts) return "unknown";
  const ms = ts < 10_000_000_000 ? ts * 1000 : ts;
  return new Date(ms).toISOString();
}

function summarizeEntry(entry, pgIds) {
  const id = String(entry?.id || "");
  return {
    id,
    title: String(entry?.title || entry?.analysis?.callHeader?.title || "(untitled)"),
    timestamp: fmtTime(entry),
    zoomKey: canonicalZoomLink(entry) || "(none)",
    wordCount: wordCount(entry),
    hasPostCall: pgIds.has(id),
  };
}

function chooseActions(entries, pgIds) {
  const zoomGroups = new Map();
  for (const entry of entries) {
    const zoomKey = canonicalZoomLink(entry);
    if (!zoomKey || !entry?.id) continue;
    if (!zoomGroups.has(zoomKey)) zoomGroups.set(zoomKey, []);
    zoomGroups.get(zoomKey).push(entry);
  }

  const actions = [];
  const seenRemoveIds = new Set();
  for (const zoomEntries of zoomGroups.values()) {
    if (zoomEntries.length < 2) continue;

    const signatureGroups = new Map();
    for (const entry of zoomEntries) {
      const signature = duplicateSignature(entry);
      if (!signatureGroups.has(signature)) signatureGroups.set(signature, []);
      signatureGroups.get(signature).push(entry);
    }

    for (const [signature, signatureEntries] of signatureGroups.entries()) {
      if (signatureEntries.length < 2) continue;
      const pgMatches = signatureEntries.filter((entry) => pgIds.has(String(entry.id || "")));
      const orphanMatches = signatureEntries.filter((entry) => !pgIds.has(String(entry.id || "")));
      if (!orphanMatches.length) continue;

      const keep =
        pgMatches.sort((a, b) => timestampValue(b) - timestampValue(a))[0] ||
        orphanMatches.sort((a, b) => timestampValue(b) - timestampValue(a))[0];
      for (const entry of orphanMatches) {
        const id = String(entry.id || "");
        if (!id || id === String(keep?.id || "") || seenRemoveIds.has(id)) continue;
        seenRemoveIds.add(id);
        actions.push({
          remove: summarizeEntry(entry, pgIds),
          keep: summarizeEntry(keep, pgIds),
          signature,
          reason: pgIds.has(String(keep?.id || ""))
            ? "orphan duplicate; equivalent entry exists in post_call"
            : "orphan duplicate; keeping newest equivalent blob entry",
        });
      }
    }
  }

  return actions;
}

function orphanRepeatedZoomCandidates(entries, pgIds) {
  const summarized = entries.map((entry) => summarizeEntry(entry, pgIds));
  const byZoom = new Map();
  for (const entry of summarized) {
    if (entry.zoomKey === "(none)") continue;
    byZoom.set(entry.zoomKey, (byZoom.get(entry.zoomKey) || 0) + 1);
  }
  return summarized.filter((entry) => !entry.hasPostCall && byZoom.get(entry.zoomKey) > 1);
}

async function withEmailSession(client, email, fn) {
  await client.query("BEGIN");
  try {
    const sessionRes = await client.query(
      `SELECT u.id AS user_id,
              ou.path AS org_path,
              EXISTS (
                SELECT 1 FROM user_role ur
                JOIN app_role ar ON ar.id = ur.role_id
                WHERE ur.user_id = u.id
                  AND ar.name = 'admin'
                  AND ur.valid_from <= now()
                  AND (ur.valid_to IS NULL OR ur.valid_to > now())
              ) AS is_admin
       FROM app_user u
       LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
       WHERE lower(u.email) = $1
         AND u.status = 'active'
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [email],
    );
    const session = sessionRes.rows[0] || {};
    await client.query(
      `SELECT
         set_config('app.email', $1, true),
         set_config('app.user_id', $2, true),
         set_config('app.org_unit_path', $3, true),
         set_config('app.is_admin', $4, true)`,
      [
        email,
        session.user_id == null ? "" : String(session.user_id),
        typeof session.org_path === "string" ? session.org_path : "",
        session.is_admin === true ? "true" : "false",
      ],
    );
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

async function main() {
  loadDevVars();
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const email = normalizeEmail(args.email);
  if (!email) throw new Error(`--email is required.\n${usage()}`);
  if (args.apply && args.dryRun && process.argv.includes("--dry-run")) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("Set DATABASE_URL for janus_app.");

  const client = new pg.Client(pgClientConfig(databaseUrl));
  await client.connect();
  try {
    const result = await withEmailSession(client, email, async () => {
      const historyRes = await client.query("SELECT history FROM user_kv WHERE email = $1", [email]);
      const history = historyRes.rows[0]?.history;
      if (!Array.isArray(history)) {
        return { before: 0, after: 0, entries: [], pgIds: new Set(), actions: [] };
      }

      const callIds = [...new Set(history.map((entry) => String(entry?.id || "")).filter(Boolean))];
      const postCallRes = callIds.length
        ? await client.query("SELECT public_id FROM post_call WHERE public_id = ANY($1::text[])", [callIds])
        : { rows: [] };
      const pgIds = new Set(postCallRes.rows.map((row) => String(row.public_id || "")));
      const actions = chooseActions(history, pgIds);
      const removeIds = new Set(actions.map((action) => action.remove.id));
      const nextHistory = history.filter((entry) => !removeIds.has(String(entry?.id || "")));

      if (args.apply && actions.length) {
        await client.query(
          `UPDATE user_kv
           SET history = $2::jsonb,
               updated_at = now()
           WHERE email = $1`,
          [email, JSON.stringify(nextHistory)],
        );
      }

      return {
        before: history.length,
        after: nextHistory.length,
        entries: history.map((entry) => summarizeEntry(entry, pgIds)),
        candidates: orphanRepeatedZoomCandidates(history, pgIds),
        pgIds,
        actions,
      };
    });

    console.log(`${args.apply ? "apply" : "dry-run"}: history dedupe for ${email}`);
    console.log(`before=${result.before} after=${result.after} remove=${result.actions.length}`);

    const repeatedZoomEntries = result.entries.filter((entry) => entry.zoomKey !== "(none)");
    const byZoom = new Map();
    for (const entry of repeatedZoomEntries) {
      byZoom.set(entry.zoomKey, (byZoom.get(entry.zoomKey) || 0) + 1);
    }
    const repeated = repeatedZoomEntries.filter((entry) => byZoom.get(entry.zoomKey) > 1);
    if (repeated.length) {
      console.log("\nRepeated Zoom blob entries:");
      for (const entry of repeated) {
        console.log(
          `- ${entry.id} | pg=${entry.hasPostCall ? "yes" : "no"} | ${entry.timestamp} | ` +
            `${entry.title} | words=${entry.wordCount ?? "unknown"} | ${entry.zoomKey}`,
        );
      }
    }

    if (result.candidates.length) {
      console.log("\nOrphan repeated-Zoom candidates:");
      for (const entry of result.candidates) {
        console.log(
          `- ${entry.id} | ${entry.timestamp} | ${entry.title} | ` +
            `words=${entry.wordCount ?? "unknown"} | ${entry.zoomKey}`,
        );
      }
    }

    if (!result.actions.length) {
      console.log("\nNo dedupe actions proposed.");
      return;
    }

    console.log("\nProposed dedupe actions:");
    for (const action of result.actions) {
      console.log(
        `- remove ${action.remove.id} (${action.remove.timestamp}, ${action.remove.title}, ` +
          `words=${action.remove.wordCount ?? "unknown"}, pg=no)`,
      );
      console.log(
        `  keep   ${action.keep.id} (${action.keep.timestamp}, ${action.keep.title}, ` +
          `words=${action.keep.wordCount ?? "unknown"}, pg=${action.keep.hasPostCall ? "yes" : "no"})`,
      );
      console.log(`  reason ${action.reason}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
