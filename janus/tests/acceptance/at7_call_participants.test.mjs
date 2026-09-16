#!/usr/bin/env node
/**
 * AT-7 — call participants, five kinds (D9, D11).
 *
 * The post-call pipeline already computed the identity stamp
 * (stampCallIdentities in web/domain/dual-write.js) and wrote it onto the
 * postCalls document, then discarded it: nothing in worker/src referenced
 * call_participant at all. So an SE on a call was a name string at best, and
 * could not be joined to their team, manager or scorecards.
 *
 * Asserts:
 *   1. All five kinds write: contact · se · ae · internal_leader · room.
 *   2. An SE carries a REAL app_user FK, not a name — the precision D9 exists
 *      to stop losing.
 *   3. Exactly one primary SE per call.
 *   4. Each kind must carry the identity its kind actually has.
 *   5. A room carries no participant_role, because a room does not participate.
 *   6. v_call_identities rebuilds CallIdentities from the rows.
 *   7. Replace-not-merge: a re-analysis does not leave a removed person behind.
 *
 * Usage: node janus/tests/acceptance/at7_call_participants.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq, expectReject,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

try {
  const org = await provisionOrg(mig);
  const primary = await provisionUser(mig, { slug: "p", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const second = await provisionUser(mig, { slug: "s", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const leader = await provisionUser(mig, {
    slug: "l", orgUnitId: org.segNb, orgPath: org.paths[org.segNb],
    role: "manager", jobTitle: "Director - Solution Engineering" });
  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [primary.id] });
  const deal = await provisionDeal(mig, {
    slug: "d1", accountId: acc.id, ownerUserId: primary.id, orgUnitId: org.teamA });

  const contacts = [];
  for (const n of ["c1", "c2"]) {
    const r = await mig.query(
      `INSERT INTO contact (public_id, account_id, email, name, sync_state)
       VALUES ($1, $2, $3, $4, 'synced') RETURNING id`,
      [`${RUN}_${n}`, acc.id, `${RUN}_${n}@example.test`, `Contact ${n}`]);
    contacts.push(Number(r.rows[0].id));
  }

  const act = await asUser(app, primary, async (c) =>
    insertActivity(c, {
      slug: "call1", dealId: deal.id, accountId: acc.id,
      ownerUserId: primary.id, orgUnitId: org.teamA, type: "call" }));

  /** What replaceCallParticipants does, exercised through the same SQL. */
  async function writeParticipants(c, { primarySe, secondarySes = [], leaders = [],
                                        ae = null, contactIds = [], rooms = [] }) {
    await c.query(`DELETE FROM call_participant WHERE activity_id = $1`, [act.id]);
    const add = (kind, o) => c.query(
      `INSERT INTO call_participant (activity_id, participant_kind, app_user_id, contact_id,
         participant_name, participant_email, participant_role, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [act.id, kind, o.appUserId ?? null, o.contactId ?? null, o.name ?? null,
       o.email ?? null, kind === "room" ? null : (o.role ?? "attendee"), !!o.isPrimary]);
    if (primarySe) await add("se", { appUserId: primarySe, isPrimary: true, role: "presenter" });
    for (const id of secondarySes) await add("se", { appUserId: id });
    for (const id of leaders) await add("internal_leader", { appUserId: id, role: "observer" });
    if (ae) await add("ae", { name: ae.name, email: ae.email });
    for (const id of contactIds) await add("contact", { contactId: id });
    for (const name of rooms) await add("room", { name });
  }

  // -------------------------------------------------------------------------
  // 1. All five kinds
  // -------------------------------------------------------------------------
  await asUser(app, primary, async (c) => {
    await writeParticipants(c, {
      primarySe: primary.id,
      secondarySes: [second.id],
      leaders: [leader.id],
      ae: { name: "Dana Cole", email: "dana@northwind.test" },
      contactIds: contacts,
      rooms: ["Chennai-3F-Boardroom"],
    });
  });

  const kinds = await mig.query(
    `SELECT participant_kind, count(*)::int n FROM call_participant
      WHERE activity_id = $1 GROUP BY 1 ORDER BY 1`, [act.id]);
  const byKind = Object.fromEntries(kinds.rows.map((r) => [r.participant_kind, r.n]));

  checkEq("AT-7.1a all five kinds present",
          Object.keys(byKind).sort(),
          ["ae", "contact", "internal_leader", "room", "se"]);
  checkEq("AT-7.1b two SEs, two contacts, one each of the rest",
          [byKind.se, byKind.contact, byKind.ae, byKind.internal_leader, byKind.room],
          [2, 2, 1, 1, 1]);

  // -------------------------------------------------------------------------
  // 2. An SE is a real FK, not a name
  // -------------------------------------------------------------------------
  const seRows = await mig.query(
    `SELECT p.app_user_id, p.participant_name, u.email
       FROM call_participant p LEFT JOIN app_user u ON u.id = p.app_user_id
      WHERE p.activity_id = $1 AND p.participant_kind = 'se'
      ORDER BY p.is_primary DESC`, [act.id]);
  check("AT-7.2a every SE carries an app_user FK",
        seRows.rows.every((r) => r.app_user_id != null),
        seRows.rows.map((r) => r.email).join(", "));
  check("AT-7.2b and therefore joins to a real user, not a string",
        seRows.rows.every((r) => !!r.email && r.participant_name == null),
        "name is null because the FK carries the identity");

  // The join D9 exists to enable: participant -> their team.
  const toTeam = await mig.query(
    `SELECT DISTINCT ou.id team FROM call_participant p
       JOIN app_user u ON u.id = p.app_user_id
       JOIN org_unit ou ON ou.id = u.org_unit_id
      WHERE p.activity_id = $1 AND p.participant_kind = 'se'`, [act.id]);
  checkEq("AT-7.2c a participant joins through to their team", toTeam.rowCount, 1);

  // -------------------------------------------------------------------------
  // 3. One primary SE
  // -------------------------------------------------------------------------
  const prim = await mig.query(
    `SELECT count(*)::int n FROM call_participant
      WHERE activity_id = $1 AND is_primary`, [act.id]);
  checkEq("AT-7.3a exactly one primary", prim.rows[0].n, 1);

  await expectReject(mig, "AT-7.3b a second primary SE is rejected",
    `INSERT INTO call_participant (activity_id, participant_kind, app_user_id,
       is_primary, participant_role)
     VALUES ($1, 'se', $2, true, 'presenter')`,
    [act.id, leader.id], "23505");

  await expectReject(mig, "AT-7.3c a non-SE cannot be primary",
    `INSERT INTO call_participant (activity_id, participant_kind, participant_name, is_primary)
     VALUES ($1, 'ae', 'Someone', true)`,
    [act.id], "23514");

  // -------------------------------------------------------------------------
  // 4. Each kind carries the identity its kind has
  // -------------------------------------------------------------------------
  await expectReject(mig, "AT-7.4a an SE with no app_user is rejected",
    `INSERT INTO call_participant (activity_id, participant_kind, participant_name)
     VALUES ($1, 'se', 'Nameless SE')`, [act.id], "23514");
  await expectReject(mig, "AT-7.4b a contact with no contact_id is rejected",
    `INSERT INTO call_participant (activity_id, participant_kind, participant_name)
     VALUES ($1, 'contact', 'Ghost')`, [act.id], "23514");
  await expectReject(mig, "AT-7.4c an AE with an app_user_id is rejected (AEs are not users)",
    `INSERT INTO call_participant (activity_id, participant_kind, app_user_id, participant_name)
     VALUES ($1, 'ae', $2, 'Wrong')`, [act.id, second.id], "23514");
  await expectReject(mig, "AT-7.4d an invented kind is rejected",
    `INSERT INTO call_participant (activity_id, participant_kind, participant_name)
     VALUES ($1, 'alien', 'X')`, [act.id], "23514");

  // An app_user FK alone is sufficient identity. This is the constraint that
  // 02_phase2_activities.sql got wrong -- it predated app_user_id and rejected
  // exactly the row D9 needs.
  const fkOnly = await mig.query(
    `SELECT count(*)::int n FROM call_participant
      WHERE activity_id = $1 AND app_user_id IS NOT NULL
        AND participant_name IS NULL AND participant_email IS NULL
        AND contact_id IS NULL`, [act.id]);
  check("AT-7.4e an app_user FK alone is accepted as identity",
        fkOnly.rows[0].n === 3,
        `${fkOnly.rows[0].n} row(s) identified by FK alone`);

  // -------------------------------------------------------------------------
  // 5. A room does not participate
  // -------------------------------------------------------------------------
  const room = await mig.query(
    `SELECT participant_role, participant_name FROM call_participant
      WHERE activity_id = $1 AND participant_kind = 'room'`, [act.id]);
  checkEq("AT-7.5a a room carries no role", room.rows[0].participant_role, null);
  await expectReject(mig, "AT-7.5b giving a room a role is rejected",
    `INSERT INTO call_participant (activity_id, participant_kind, participant_name, participant_role)
     VALUES ($1, 'room', 'Room 2', 'attendee')`, [act.id], "23514");

  // -------------------------------------------------------------------------
  // 6. The identity stamp rebuilds from the rows
  // -------------------------------------------------------------------------
  const v = await mig.query(
    `SELECT * FROM v_call_identities WHERE activity_id = $1`, [act.id]);
  const st = v.rows[0];
  checkEq("AT-7.6a primary SE recovered", Number(st.primary_se_user_id), primary.id);
  checkEq("AT-7.6b secondary SEs recovered", st.secondary_se_user_ids.map(Number), [second.id]);
  checkEq("AT-7.6c AE recovered", [st.ae_name, st.ae_email],
          ["Dana Cole", "dana@northwind.test"]);
  checkEq("AT-7.6d contacts recovered", st.contact_ids.map(Number).sort((a,b)=>a-b),
          contacts.sort((a,b)=>a-b));
  checkEq("AT-7.6e rooms recovered", st.room_names, ["Chennai-3F-Boardroom"]);

  // -------------------------------------------------------------------------
  // 7. Replace, not merge
  //
  // A re-analysis recomputes the whole set. Merging would leave someone on a
  // call they were taken off.
  // -------------------------------------------------------------------------
  await asUser(app, primary, async (c) => {
    await writeParticipants(c, {
      primarySe: primary.id,
      contactIds: [contacts[0]],       // second SE, leader, AE, room, 2nd contact all dropped
    });
  });
  const after = await mig.query(
    `SELECT participant_kind, count(*)::int n FROM call_participant
      WHERE activity_id = $1 GROUP BY 1 ORDER BY 1`, [act.id]);
  checkEq("AT-7.7a re-analysis replaces the whole set",
          Object.fromEntries(after.rows.map((r) => [r.participant_kind, r.n])),
          { contact: 1, se: 1 });
  const stale = await mig.query(
    `SELECT count(*)::int n FROM call_participant
      WHERE activity_id = $1 AND app_user_id = $2`, [act.id, second.id]);
  checkEq("AT-7.7b a removed participant does not linger", stale.rows[0].n, 0);

  // -------------------------------------------------------------------------
  // 8. RLS
  // -------------------------------------------------------------------------
  const noCtx = await app.query(
    `SELECT count(*)::int n FROM call_participant WHERE activity_id = $1`, [act.id]);
  checkEq("AT-7.8 a session with no context reads 0 participants (fail-closed)",
          noCtx.rows[0].n, 0);

  process.exitCode = summary("AT-7 call participants") ? 0 : 1;
} finally {
  await mig.query(
    `DELETE FROM call_participant WHERE activity_id IN
       (SELECT id FROM activity WHERE public_id LIKE '${RUN}\\_%')`).catch(() => {});
  await mig.query(`DELETE FROM contact WHERE public_id LIKE '${RUN}\\_%'`).catch(() => {});
  await teardown(mig);
  await app.end();
  await mig.end();
}
