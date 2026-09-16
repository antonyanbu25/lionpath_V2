#!/usr/bin/env node
/**
 * Provision the org hierarchy and roster into Postgres from the seed CSV.
 *
 * THIS IS THE KEYSTONE. Nothing else can write until it has run:
 * activity.owner_user_id and activity.org_unit_id are both NOT NULL, and
 * upsertActivity resolves the owner through id_registry -- so every prep
 * brief, post-call and scorecard write throws
 * "id_registry: no mapping for app_user/<id>" until the person exists here.
 *
 * This is PROVISIONING, not migration. Postgres starts empty (D6) and nothing
 * is copied out of Firestore; these rows are created from the roster CSV,
 * which is the same source the Firestore seed uses. Re-runnable: every write
 * is an upsert keyed on a stable id.
 *
 * What it creates
 * ---------------
 *   org_unit         the three-level tree, with materialised paths
 *   org_unit_leader  director / segment_leader / team_manager (temporal)
 *   app_user         one per roster row, with job_level DERIVED not defaulted
 *   user_role        the current permission grant (temporal, close-then-insert)
 *   id_registry      app_user public_id -> bigint, which the write paths need
 *
 * The vocabulary trap (D4), which this script exists to get right
 * ---------------------------------------------------------------
 * Business users call level 2 a "team" and level 3 a "segment". The SYSTEM is
 * the other way round: level 2 is the segment (unit_type='region'), level 3 is
 * the team, named after its manager.
 *
 *   org_freshworks_se                      unit_type = 'org'
 *     +-- seg_new_business                 unit_type = 'region'
 *     |     +-- team_ajay, team_nikil      unit_type = 'team'
 *     +-- seg_digital
 *     |     +-- team_akshita
 *     +-- seg_nurture
 *           +-- team_mary, team_varun
 *
 * Building it with the business vocabulary inverts every parent_id and
 * therefore every path -- and since EVERY row-level security policy is a path
 * prefix match, a segment leader would silently see the wrong people.
 *
 * Usage:
 *   node janus/scripts/provision-identity.mjs --dry-run
 *   node janus/scripts/provision-identity.mjs
 *   node janus/scripts/provision-identity.mjs --csv worker/scripts/seed-users.csv
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDevVars, WORKER_ROOT } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

const require = createRequire(join(WORKER_ROOT, "package.json"));
loadDevVars();

const REPO_ROOT = join(WORKER_ROOT, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const csvArg = (() => {
  const i = argv.indexOf("--csv");
  return i === -1 ? null : argv[i + 1];
})();

const csvPath = csvArg
  ? (csvArg.startsWith("/") ? csvArg : join(REPO_ROOT, csvArg))
  : join(WORKER_ROOT, "scripts", "seed-users.example.csv");

// ---------------------------------------------------------------------------
// D15 — segment to motion. A 3->2 mapping, expressed as data on org_unit
// rather than as the hardcoded id sets in domain-model/se-motion.ts.
// ---------------------------------------------------------------------------
const SEGMENT_MOTION = {
  seg_new_business: "new_business",
  seg_digital: "expansion",
  seg_nurture: "expansion",
};

const SEGMENT_NAMES = {
  seg_new_business: "New Business",
  seg_digital: "Digital",
  seg_nurture: "Nurture",
};

const ORG_NAME = "Freshworks CX Solution Engineering";

// ---------------------------------------------------------------------------
// User public_ids CANNOT be derived from the email.
//
// The authoritative id is minted as `usr_${crypto.randomUUID()}`
// (worker/scripts/seed-firestore-users.mjs:42) and stored on the Firestore
// user document. stableUserIdForEmail() in web/domain/id.js produces
// `usr_dummy_<email>` and is for LOCAL/DUMMY users only -- it is not what real
// accounts carry.
//
// This matters more than it looks. In dual mode the browser sends ownerId
// straight from the Firestore user doc, and upsertActivity resolves it through
// id_registry. If app_user.public_id does not match that exact string, EVERY
// write fails with "id_registry: no mapping for app_user/usr_...". Inventing
// ids here would silently provision 46 people the application can never find.
//
// So the id must be supplied. Two ways:
//   1. an `id` column in the roster CSV, or
//   2. --ids <file.json>, a { "email": "usr_..." } map produced by
//      node janus/scripts/export-user-ids.mjs
// ---------------------------------------------------------------------------
const idsArg = (() => {
  const i = argv.indexOf("--ids");
  return i === -1 ? null : argv[i + 1];
})();
const allowGenerated = argv.includes("--allow-generated-ids");
// Provision the people whose real id we know and REPORT the rest, instead of
// refusing the whole roster because some have never signed in. The org tree
// does not depend on user ids, so it is built either way.
const skipUnmapped = argv.includes("--skip-unmapped");

let idByEmail = {};
if (idsArg) {
  const p = idsArg.startsWith("/") ? idsArg : join(REPO_ROOT, idsArg);
  const raw = JSON.parse(readFileSync(p, "utf8"));
  // Accept either { email: id } or [{ email, id }].
  idByEmail = Array.isArray(raw)
    ? Object.fromEntries(raw.map((r) => [String(r.email).toLowerCase(), r.id]))
    : Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  console.log(`Ids: ${p} (${Object.keys(idByEmail).length} mapping(s))`);
}

function teamNameFor(teamId) {
  const slug = teamId.replace(/^team_/, "");
  return `Team ${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Parse the CSV (no dependency — it is a flat, quote-free roster file)
// ---------------------------------------------------------------------------
const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
const header = lines[0].split(",").map((h) => h.trim());
const roster = lines.slice(1).map((line) => {
  const cells = line.split(",");
  const row = {};
  header.forEach((h, i) => {
    const v = (cells[i] ?? "").trim();
    row[h] = v === "-" || v === "" ? null : v;
  });
  return row;
});

function userPublicIdFor(email) {
  const key = email.toLowerCase();
  const fromMap = idByEmail[key];
  if (fromMap) return fromMap;
  const fromCsv = roster.find((r) => r.email?.toLowerCase() === key)?.id;
  if (fromCsv) return fromCsv;
  if (allowGenerated) {
    // Deterministic so a re-run is stable, and clearly marked so it is
    // obvious in the database that this id was not the Firestore one.
    return `usr_provisioned_${key.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
  }
  return null;
}

const problems = [];
const seenEmails = new Set();
for (const r of roster) {
  if (!r.email) problems.push(`row with no email: ${JSON.stringify(r)}`);
  else if (seenEmails.has(r.email.toLowerCase())) problems.push(`duplicate email ${r.email}`);
  else seenEmails.add(r.email.toLowerCase());
  if (!r.role) problems.push(`${r.email}: no role`);
  else if (!["admin", "manager", "se", "pm"].includes(r.role)) {
    problems.push(`${r.email}: unknown role "${r.role}" — app_role has admin|manager|se|pm`);
  }
  if (r.segmentId && !SEGMENT_MOTION[r.segmentId]) {
    problems.push(`${r.email}: segment "${r.segmentId}" has no D15 motion mapping`);
  }
  if (r.managerEmail && !roster.some((x) => x.email?.toLowerCase() === r.managerEmail.toLowerCase())) {
    problems.push(`${r.email}: managerEmail ${r.managerEmail} is not on the roster`);
  }
}

const unmapped = roster.filter((r) => r.email && !userPublicIdFor(r.email));
if (unmapped.length > 0 && skipUnmapped) {
  console.log(
    `\n${unmapped.length} of ${roster.length} roster member(s) have no public_id and will be ` +
      `SKIPPED (--skip-unmapped).\n` +
      `They exist in Firestore but not yet in app_user, so their real id is unknown here. ` +
      `Until they are provisioned their writes fall through to Firestore.\n` +
      `To include them: node janus/scripts/export-user-ids.mjs > user-ids.json\n`,
  );
  for (const r of unmapped) console.log(`    skip  ${r.email}`);
  console.log("");
}
const missingIds = skipUnmapped ? 0 : unmapped.length;
if (missingIds > 0) {
  console.error(
    `\n${missingIds} of ${roster.length} people have no public_id, and it CANNOT be derived\n` +
      `from the email -- the real id is a random UUID minted by\n` +
      `worker/scripts/seed-firestore-users.mjs and stored on the Firestore user doc.\n\n` +
      `In dual mode the browser sends that exact string as ownerId, and\n` +
      `upsertActivity resolves it through id_registry -- so a mismatch means every\n` +
      `write fails with "no mapping for app_user/usr_...".\n\n` +
      `Supply the real ids one of these ways:\n\n` +
      `  1. Export them from Firestore (needs GOOGLE_APPLICATION_CREDENTIALS):\n` +
      `       node janus/scripts/export-user-ids.mjs > user-ids.json\n` +
      `       node janus/scripts/provision-identity.mjs --ids user-ids.json\n\n` +
      `  2. Add an \`id\` column to the roster CSV.\n\n` +
      `  3. --allow-generated-ids  -- ONLY for a throwaway staging database with no\n` +
      `     Firestore behind it. Mints usr_provisioned_<email> ids, which the app\n` +
      `     will NOT match. Useful for exercising the schema, useless for a real run.\n`,
  );
  process.exit(1);
}
if (problems.length) {
  console.error("Roster is not provisionable:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Derive the tree. A team's parent is its SEGMENT, looked up from the roster
// rows -- NOT the org. This is the highest-risk transform in the workstream:
// a team parented to the org produces a path one level short, and a segment
// leader then silently sees nothing.
// ---------------------------------------------------------------------------
const orgId = roster.find((r) => r.orgId)?.orgId || "org_freshworks_se";
const teamToSegment = new Map();
for (const r of roster) {
  if (r.teamId && r.segmentId) {
    const prior = teamToSegment.get(r.teamId);
    if (prior && prior !== r.segmentId) {
      console.error(
        `Team ${r.teamId} is claimed by two segments (${prior} and ${r.segmentId}). ` +
          `A team belongs to exactly one segment; fix the roster.`,
      );
      process.exit(1);
    }
    teamToSegment.set(r.teamId, r.segmentId);
  }
}
const segments = [...new Set(roster.map((r) => r.segmentId).filter(Boolean))].sort();
const teamsWithoutSegment = [...new Set(roster.map((r) => r.teamId).filter(Boolean))]
  .filter((t) => !teamToSegment.has(t));

const units = [
  { id: orgId, name: ORG_NAME, parent: null, type: "org", path: `/${orgId}/`, motion: null },
];
for (const seg of segments) {
  units.push({
    id: seg,
    name: SEGMENT_NAMES[seg] || seg,
    parent: orgId,
    type: "region",
    path: `/${orgId}/${seg}/`,
    motion: SEGMENT_MOTION[seg],
  });
}
for (const [team, seg] of [...teamToSegment.entries()].sort()) {
  units.push({
    id: team,
    name: teamNameFor(team),
    parent: seg,
    type: "team",
    path: `/${orgId}/${seg}/${team}/`,
    motion: null,
  });
}
// A team with no segment anywhere on the roster parents to the org. Its SEs
// then resolve NO motion (resolve_se_motion walks up and finds nothing), which
// is deliberate -- better a loud null than a silently wrong new_business.
for (const team of teamsWithoutSegment) {
  units.push({
    id: team, name: teamNameFor(team), parent: orgId, type: "team",
    path: `/${orgId}/${team}/`, motion: null,
  });
}

// Leadership. A manager with a teamId leads that team; a manager with only a
// segmentId leads that segment; a manager with neither is the org director.
const leaders = [];
for (const r of roster) {
  if (r.role !== "manager") continue;
  if (r.teamId) leaders.push({ unit: r.teamId, email: r.email, kind: "team_manager" });
  else if (r.segmentId) leaders.push({ unit: r.segmentId, email: r.email, kind: "segment_leader" });
  else leaders.push({ unit: orgId, email: r.email, kind: "director" });
}

// The unit each person belongs to: deepest wins (team, else segment, else org).
function unitFor(r) {
  return r.teamId || r.segmentId || orgId;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`Roster: ${csvPath}`);
console.log(`  ${roster.length} people, ${units.length} org units, ${leaders.length} leadership rows`);
console.log(`\nOrg tree:`);
for (const u of units) {
  const indent = "  ".repeat((u.path.match(/\//g) || []).length - 1);
  const members = roster.filter((r) => unitFor(r) === u.id).length;
  const led = leaders.filter((l) => l.unit === u.id)
    .map((l) => `${l.kind}=${l.email.split("@")[0]}`).join(", ");
  console.log(
    `  ${indent}${u.id.padEnd(20)} ${u.type.padEnd(7)}` +
      `${u.motion ? ` motion=${u.motion.padEnd(13)}` : " ".repeat(21)}` +
      `${String(members).padStart(2)} member(s)${led ? `  [${led}]` : ""}`,
  );
}

const byRole = {};
for (const r of roster) byRole[r.role] = (byRole[r.role] || 0) + 1;
console.log(`\nRoles: ${Object.entries(byRole).map(([k, v]) => `${k}=${v}`).join(", ")}`);

const unmanagedTeams = [...teamToSegment.keys()]
  .filter((t) => !leaders.some((l) => l.unit === t && l.kind === "team_manager"));
if (unmanagedTeams.length) {
  console.log(
    `\n  !! ${unmanagedTeams.join(", ")} has SEs but no manager on the roster, so no ` +
      `team_manager leader row will exist. Their SEs still resolve a motion from the ` +
      `segment, so scoring works — but nobody is recorded as leading the team.`,
  );
}
if (teamsWithoutSegment.length) {
  console.log(
    `\n  !! ${teamsWithoutSegment.join(", ")} is in no segment, so it parents to the org and ` +
      `its SEs resolve NO motion. Set org_unit.default_se_motion on the team directly, or ` +
      `put it in a segment.`,
  );
}

if (dryRun) {
  console.log("\ndry-run — nothing written.");
  console.log("\nPeople (job_level is derived from jobTitle, never defaulted to IC):");
  for (const r of roster) {
    console.log(
      `  ${userPublicIdFor(r.email).padEnd(34)} ${(r.role || "").padEnd(8)} ` +
        `${unitFor(r).padEnd(18)} ${(r.jobTitle || "(no title)").slice(0, 44)}`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write. Needs the migration role: app_user and org_unit have no RLS, but
// org_unit_leader does not yet exist for the session to be scoped against,
// and provisioning legitimately writes rows for other people.
// ---------------------------------------------------------------------------
const url = process.env.DATABASE_URL_MIGRATIONS || "";
if (!url) {
  console.error(
    "\nSet DATABASE_URL_MIGRATIONS in worker/.dev.vars.\n" +
      "Provisioning writes rows on behalf of other people, which the owner-scoped\n" +
      "janus_app policies correctly refuse.",
  );
  process.exit(1);
}
if (/^postgres(ql)?:\/\/janus_app[:@]/i.test(url)) {
  console.error("Provisioning cannot run as janus_app — use the migration role.");
  process.exit(1);
}

const pg = require("pg");
const client = new pg.Client(pgClientConfig(url));
await client.connect();

const counts = { units: 0, users: 0, roles: 0, leaders: 0, managers: 0 };

try {
  await client.query("BEGIN");

  // Reference roles must exist — 21_identity_relationships.sql seeds them.
  const roleRows = await client.query(`SELECT id, name FROM app_role`);
  const roleIdByName = Object.fromEntries(roleRows.rows.map((r) => [r.name, r.id]));
  for (const needed of ["admin", "manager", "se", "pm"]) {
    if (!roleIdByName[needed]) {
      throw new Error(
        `app_role has no "${needed}" row. Apply 21_identity_relationships.sql first — ` +
          `resolveSqlSession joins app_role BY NAME, so the admin check is otherwise ` +
          `permanently unsatisfiable.`,
      );
    }
  }

  // 1. Org units, parents before children (units[] is already in tree order).
  for (const u of units) {
    await client.query(
      `INSERT INTO org_unit (id, name, parent_id, unit_type, path, default_se_motion, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         parent_id = EXCLUDED.parent_id,
         unit_type = EXCLUDED.unit_type,
         path = EXCLUDED.path,
         default_se_motion = EXCLUDED.default_se_motion,
         updated_at = now()`,
      [u.id, u.name, u.parent, u.type, u.path, u.motion],
    );
    counts.units += 1;
  }

  // 2. People. job_level via derive_job_level, so a Senior Director is not
  //    provisioned as an IC (which upsertAppUser's 'IC' default would do).
  const provisionable = roster.filter((r) => r.email && userPublicIdFor(r.email));
  const userIdByEmail = new Map();
  for (const r of provisionable) {
    const publicId = userPublicIdFor(r.email);
    const res = await client.query(
      `INSERT INTO app_user (public_id, email, display_name, job_title, job_level,
                             org_unit_id, status, sync_state, updated_at)
       VALUES ($1, $2, $3, $4, derive_job_level($4, $5), $6, 'active', 'synced', now())
       ON CONFLICT (public_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         job_title = EXCLUDED.job_title,
         job_level = EXCLUDED.job_level,
         org_unit_id = EXCLUDED.org_unit_id,
         status = 'active',
         updated_at = now()
       RETURNING id`,
      [publicId, r.email.toLowerCase(), r.displayName, r.jobTitle, r.role, unitFor(r)],
    );
    const id = Number(res.rows[0].id);
    userIdByEmail.set(r.email.toLowerCase(), id);
    // The write paths resolve owners through id_registry, not by public_id.
    await client.query(`SELECT register_id('app_user', $1, $2)`, [publicId, id]);
    counts.users += 1;
  }

  // 3. Reporting line, second pass — every user id is known by now.
  for (const r of provisionable) {
    if (!r.managerEmail) continue;
    const managerId = userIdByEmail.get(r.managerEmail.toLowerCase());
    const selfId = userIdByEmail.get(r.email.toLowerCase());
    if (!managerId || managerId === selfId) continue;
    await client.query(
      `UPDATE app_user SET manager_user_id = $2, updated_at = now() WHERE id = $1`,
      [selfId, managerId],
    );
    counts.managers += 1;
  }

  // 4. Permission roles. user_role carries a GIST exclusion constraint, so a
  //    change is close-then-insert -- never an UPDATE, never a second
  //    overlapping grant.
  for (const r of provisionable) {
    const userId = userIdByEmail.get(r.email.toLowerCase());
    const roleId = roleIdByName[r.role];

    const current = await client.query(
      `SELECT role_id FROM user_role
        WHERE user_id = $1 AND valid_from <= now()
          AND (valid_to IS NULL OR valid_to > now())`,
      [userId],
    );
    if (current.rows.some((x) => x.role_id === roleId)) continue;   // already correct

    await client.query(
      `UPDATE user_role SET valid_to = now() WHERE user_id = $1 AND valid_to IS NULL`,
      [userId],
    );
    await client.query(
      `INSERT INTO user_role (user_id, role_id, valid_from) VALUES ($1, $2, now())`,
      [userId, roleId],
    );
    counts.roles += 1;
  }

  // 5. Leadership. Temporal, so a change is closed and re-opened rather than
  //    overwritten (D7 -- a leadership change alters what someone can see).
  for (const l of leaders) {
    const userId = userIdByEmail.get(l.email.toLowerCase());
    if (userId == null) {
      console.warn(
        `  skip leadership ${l.kind} of ${l.unit}: ${l.email} is not provisioned`,
      );
      continue;
    }
    const existing = await client.query(
      `SELECT user_id FROM org_unit_leader
        WHERE org_unit_id = $1 AND leader_kind = $2 AND valid_to IS NULL`,
      [l.unit, l.kind],
    );
    if (existing.rows.some((x) => Number(x.user_id) === userId)) continue;

    if (l.kind !== "senior_leader") {
      await client.query(
        `UPDATE org_unit_leader SET valid_to = now()
          WHERE org_unit_id = $1 AND leader_kind = $2 AND valid_to IS NULL`,
        [l.unit, l.kind],
      );
    }
    await client.query(
      `INSERT INTO org_unit_leader (org_unit_id, user_id, leader_kind, valid_from)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (org_unit_id, user_id, leader_kind, valid_from) DO NOTHING`,
      [l.unit, userId, l.kind],
    );
    counts.leaders += 1;
  }

  await client.query("COMMIT");

  // -------------------------------------------------------------------------
  // Verify what landed, including the motion resolution every score depends on
  // -------------------------------------------------------------------------
  console.log(
    `\nProvisioned: ${counts.units} org units, ${counts.users} people, ` +
      `${counts.roles} role grant(s), ${counts.leaders} leadership row(s), ` +
      `${counts.managers} reporting link(s).`,
  );

  const levels = await client.query(
    `SELECT COALESCE(job_level, '(null)') AS job_level, count(*)::int AS n
       FROM app_user WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1`);
  console.log("\njob_level distribution (derived, not defaulted):");
  for (const r of levels.rows) console.log(`  ${r.job_level.padEnd(10)} ${r.n}`);

  const motions = await client.query(
    `SELECT COALESCE(resolve_se_motion(u.org_unit_id), '(UNRESOLVED)') AS motion,
            count(*)::int AS n
       FROM app_user u WHERE u.deleted_at IS NULL GROUP BY 1 ORDER BY 1`);
  console.log("\nMotion each person resolves to (D14/D15, server-side):");
  for (const r of motions.rows) console.log(`  ${r.motion.padEnd(14)} ${r.n}`);

  const unresolved = await client.query(
    `SELECT u.email, u.org_unit_id FROM app_user u
      WHERE u.deleted_at IS NULL AND resolve_se_motion(u.org_unit_id) IS NULL
      ORDER BY u.email`);
  if (unresolved.rows.length) {
    console.log(
      `\n  !! ${unresolved.rows.length} person(s) resolve NO motion. Their calls cannot pick a\n` +
        `     QIP catalog server-side and will fall back — which is exactly the silent\n` +
        `     default D14 removes. Set default_se_motion on their unit or an ancestor:`,
    );
    for (const r of unresolved.rows) console.log(`       ${r.email}  (${r.org_unit_id})`);
  }

  const admins = await client.query(
    `SELECT u.email FROM app_user u
       JOIN v_user_current_role vr ON vr.user_id = u.id
      WHERE vr.role_name = 'admin' ORDER BY u.email`);
  console.log(`\nAdmins (resolveSqlSession checks app_role BY NAME): ${
    admins.rows.map((r) => r.email).join(", ") || "NONE — the admin check will never pass"}`);

  console.log(
    "\nNOTE: user_identity is deliberately NOT written here. auth_uid comes from\n" +
      "Firebase at first login, and resolveSqlSession looks a person up by\n" +
      "(auth_provider, auth_uid). Until that row exists the user has no SQL session,\n" +
      "so the login path must upsert user_identity on first authenticated request.",
  );
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nProvisioning failed — rolled back, nothing changed.\n");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
