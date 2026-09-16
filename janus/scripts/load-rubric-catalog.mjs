#!/usr/bin/env node
/**
 * Project the QIP profile catalog into rubric / rubric_theme / rubric_parameter.
 *
 * This is the ONLY write path for scoring profiles (D17). There is no admin
 * editing surface, and 22_scoring_reshape.sql revokes INSERT/UPDATE/DELETE on
 * all three tables from janus_app, so the application cannot write them even
 * by accident.
 *
 * The chain, unchanged from how it already works:
 *
 *   docs/QIP_SCORING_V2_1.md            human-editable source of truth (D17)
 *     -> worker/scripts/generate-rubric-profiles.mjs
 *       -> web/rubric-profiles.generated.js  (and the .ts twin)
 *         -> THIS SCRIPT
 *           -> rubric / rubric_theme / rubric_parameter
 *
 * Reads the .js twin rather than the .ts one so no build step is needed; both
 * are emitted from the same generator run and are byte-identical in content.
 *
 * At v2.1 that is 19 profiles -> 270 themes -> 1350 sub-parameters.
 *
 * A rubric edit creates a NEW VERSION; history is frozen (D18). So an
 * existing (call_type, se_motion, version) whose structure differs from the
 * catalog is an ERROR, not an update: scorecards point at the version they
 * were scored under and must never change retroactively. Bump RUBRIC_VERSION
 * in the spec instead, or pass --replace while iterating pre-launch.
 *
 * Usage:
 *   node janus/scripts/load-rubric-catalog.mjs --dry-run
 *   node janus/scripts/load-rubric-catalog.mjs
 *   node janus/scripts/load-rubric-catalog.mjs --replace     # pre-launch only
 *   node janus/scripts/load-rubric-catalog.mjs --effective-from 2026-09-15
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDevVars, WORKER_ROOT } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

// Same resolution as janus/tests/*.mjs: pg lives in worker/node_modules.
// Required lazily so --dry-run works before npm install has ever run.
const require = createRequire(join(WORKER_ROOT, "package.json"));

const REPO_ROOT = join(WORKER_ROOT, "..");
const RUBRIC_VERSION = "2.1";

const dryRun = process.argv.includes("--dry-run");
const replace = process.argv.includes("--replace");

const effectiveFromArg = (() => {
  const i = process.argv.indexOf("--effective-from");
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error("--effective-from needs a YYYY-MM-DD date");
    process.exit(1);
  }
  return v;
})();
const effectiveFrom = effectiveFromArg || new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Ids. rubricIdFor()'s exact string form, so a scorecard written by the app
// resolves to the row this loader created. NOTHING parses these back apart --
// the identity is the three explicit columns, because new_business is encoded
// as the ABSENCE of a token and that does not survive a third motion.
// ---------------------------------------------------------------------------
function rubricIdFor(callType, version, seMotion) {
  const slug = version.replace(/\./g, "_");
  return seMotion === "expansion"
    ? `rub_${callType}_expansion_${slug}`
    : `rub_${callType}_${slug}`;
}

const themeIdFor = (rubricId, themeKey) => `${rubricId}__${themeKey}`;
const paramIdFor = (themeId, index) => `${themeId}__p${index}`;

/** Structural fingerprint, for detecting a changed profile at a fixed version. */
function fingerprint(profile) {
  const shape = {
    totalCredits: profile.totalCredits,
    provisional: profile.provisional,
    active: profile.active,
    themes: profile.themes.map((t) => ({
      key: t.key,
      credit: t.credit,
      category: t.category,
      requiresVideo: !!t.requiresVideo,
      subParameters: t.subParameters,
    })),
  };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Load and pre-flight the catalog before touching the database.
// ---------------------------------------------------------------------------
const generatedPath = join(REPO_ROOT, "web", "rubric-profiles.generated.js");
const { GENERATED_QIP_PROFILES: profiles } = await import(pathToFileURL(generatedPath).href);

if (!Array.isArray(profiles) || profiles.length === 0) {
  console.error(`No profiles found in ${generatedPath}`);
  process.exit(1);
}

const preflight = [];
const seen = new Set();
let themeCount = 0;
let paramCount = 0;

for (const p of profiles) {
  const key = `${p.motion}:${p.key}`;
  if (seen.has(key)) preflight.push(`duplicate profile ${key}`);
  seen.add(key);

  if (!p.motion || !p.key) preflight.push(`profile missing key or motion: ${JSON.stringify(p).slice(0, 80)}`);
  if (p.version !== RUBRIC_VERSION) {
    preflight.push(`${key}: version ${p.version} != loader's ${RUBRIC_VERSION}`);
  }

  const sum = p.themes.reduce((a, t) => a + t.credit, 0);
  if (sum !== p.totalCredits) {
    preflight.push(`${key}: totalCredits ${p.totalCredits} but themes sum to ${sum}`);
  }
  if (p.themes.length === 0) preflight.push(`${key}: no themes`);

  const themeKeys = new Set();
  for (const t of p.themes) {
    if (themeKeys.has(t.key)) preflight.push(`${key}: duplicate theme ${t.key}`);
    themeKeys.add(t.key);
    if (t.subParameters.length !== 5) {
      preflight.push(`${key}/${t.key}: ${t.subParameters.length} sub-parameters, expected 5`);
    }
    if (![1, 2, 3].includes(t.credit)) preflight.push(`${key}/${t.key}: credit ${t.credit}`);
    themeCount += 1;
    paramCount += t.subParameters.length;
  }
}

if (preflight.length) {
  console.error("Catalog is not loadable:");
  for (const p of preflight) console.error("  - " + p);
  process.exit(1);
}

const live = profiles.filter((p) => !p.provisional);
console.log(
  `Catalog: ${profiles.length} profiles -> ${themeCount} themes -> ${paramCount} sub-parameters`,
);
console.log(
  `  by motion: ${profiles.filter((p) => p.motion === "new_business").length} new_business, ` +
    `${profiles.filter((p) => p.motion === "expansion").length} expansion`,
);
console.log(
  `  live (non-provisional): ${live.length} — ${live.map((p) => `${p.motion}/${p.key}`).join(", ") || "none"}`,
);
console.log(`  effective_from: ${effectiveFrom}`);

if (dryRun) {
  console.log("\ndry-run — nothing written.");
  console.log("Rows that would be written:");
  for (const p of profiles) {
    console.log(
      `  ${rubricIdFor(p.key, p.version, p.motion).padEnd(42)} ` +
        `credits=${String(p.totalCredits).padEnd(3)} themes=${String(p.themes.length).padEnd(3)} ` +
        `provisional=${p.provisional} fp=${fingerprint(p)}`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Connect. The catalog is loader-owned, so this needs the migration role --
// janus_app has SELECT only on these three tables by design.
// ---------------------------------------------------------------------------
loadDevVars();

const url = process.env.DATABASE_URL_MIGRATIONS || "";
if (!url) {
  console.error(
    "Set DATABASE_URL_MIGRATIONS in worker/.dev.vars.\n" +
      "The rubric catalog is loader-owned (D17): 22_scoring_reshape.sql revokes\n" +
      "INSERT/UPDATE/DELETE on rubric/rubric_theme/rubric_parameter from janus_app,\n" +
      "so DATABASE_URL will not work here.",
  );
  process.exit(1);
}
if (/^postgres(ql)?:\/\/janus_app[:@]/i.test(url)) {
  console.error("The catalog cannot be loaded as janus_app — use the migration role.");
  process.exit(1);
}

const pg = require("pg");
const client = new pg.Client(pgClientConfig(url));
await client.connect();

let written = 0;
let skipped = 0;

try {
  await client.query("BEGIN");

  for (const p of profiles) {
    const rubricId = rubricIdFor(p.key, p.version, p.motion);
    const fp = fingerprint(p);

    const existing = await client.query(
      `SELECT id, total_credits, description
         FROM rubric
        WHERE call_type = $1 AND se_motion = $2 AND version = $3`,
      [p.key, p.motion, p.version],
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const priorFp = /fp=([0-9a-f]{16})/.exec(row.description || "")?.[1];

      if (priorFp === fp) {
        skipped += 1;
        continue;
      }
      if (!replace) {
        throw new Error(
          `${p.motion}/${p.key} v${p.version} already exists with a different structure ` +
            `(stored fp=${priorFp ?? "unknown"}, catalog fp=${fp}).\n` +
            `D18: an edit creates a NEW VERSION and history is frozen — scorecards point at ` +
            `the version they were scored under. Bump the version in ` +
            `docs/QIP_SCORING_V2_1.md and regenerate, or pass --replace if this database ` +
            `holds no scores you care about.`,
        );
      }
      // --replace: children go via ON DELETE CASCADE from rubric_theme.
      await client.query(`DELETE FROM rubric_theme WHERE rubric_id = $1`, [row.id]);
    }

    await client.query(
      `INSERT INTO rubric (id, call_type, se_motion, version, name, description,
                           total_credits, provisional, active, effective_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
           call_type     = EXCLUDED.call_type,
           se_motion     = EXCLUDED.se_motion,
           version       = EXCLUDED.version,
           name          = EXCLUDED.name,
           description   = EXCLUDED.description,
           total_credits = EXCLUDED.total_credits,
           provisional   = EXCLUDED.provisional,
           active        = EXCLUDED.active`,
      [
        rubricId,
        p.key,
        p.motion,
        p.version,
        p.name,
        `QIP ${p.motion} ${p.key} v${p.version} — loaded from docs/QIP_SCORING_V2_1.md fp=${fp}`,
        p.totalCredits,
        p.provisional,
        p.active,
        effectiveFrom,
      ],
    );

    for (const [i, t] of p.themes.entries()) {
      const themeId = themeIdFor(rubricId, t.key);
      await client.query(
        `INSERT INTO rubric_theme (id, rubric_id, theme_key, name, credit, category,
                                   requires_video, display_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (id) DO UPDATE SET
             rubric_id      = EXCLUDED.rubric_id,
             theme_key      = EXCLUDED.theme_key,
             name           = EXCLUDED.name,
             credit         = EXCLUDED.credit,
             category       = EXCLUDED.category,
             requires_video = EXCLUDED.requires_video,
             display_order  = EXCLUDED.display_order`,
        [themeId, rubricId, t.key, t.key, t.credit, t.category, !!t.requiresVideo, i + 1],
      );

      for (const [j, sub] of t.subParameters.entries()) {
        await client.query(
          // param_index is smallint and display_order is int, so they cannot
          // share one placeholder -- Postgres refuses with "inconsistent types
          // deduced for parameter $3".
          `INSERT INTO rubric_parameter (id, rubric_theme_id, param_index, name,
                                         description, weight, is_locked, display_order)
           VALUES ($1, $2, $3, $4, $5, 1, true, $6)
           ON CONFLICT (id) DO UPDATE SET
               rubric_theme_id = EXCLUDED.rubric_theme_id,
               param_index     = EXCLUDED.param_index,
               name            = EXCLUDED.name,
               description     = EXCLUDED.description,
               display_order   = EXCLUDED.display_order`,
          [paramIdFor(themeId, j + 1), themeId, j + 1, sub, sub, j + 1],
        );
      }
    }
    written += 1;
  }

  // Invariants the schema cannot express as constraints: total_credits
  // matching the theme sum, exactly five sub-parameters per theme,
  // contiguous param_index. Refuse to commit a catalog that fails them.
  const problems = await client.query(`SELECT * FROM validate_rubric_catalog()`);
  if (problems.rowCount > 0) {
    for (const row of problems.rows) console.error(`  ${row.rubric_id}: ${row.problem}`);
    throw new Error(`validate_rubric_catalog() returned ${problems.rowCount} problem(s)`);
  }

  await client.query("COMMIT");

  const counts = await client.query(
    `SELECT (SELECT count(*) FROM rubric)           AS rubrics,
            (SELECT count(*) FROM rubric_theme)     AS themes,
            (SELECT count(*) FROM rubric_parameter) AS params`,
  );
  const c = counts.rows[0];
  console.log(
    `\nLoaded: ${written} profile(s) written, ${skipped} unchanged.\n` +
      `In database: ${c.rubrics} rubrics, ${c.themes} themes, ${c.params} sub-parameters.`,
  );
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nLoad failed — rolled back, nothing changed.\n");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
