#!/usr/bin/env node
/**
 * AT-6 — the last Firestore collections.
 *
 * The gap list named 13 collections with no Postgres home. On tracing what the
 * code reads, EIGHT are stored inside post_call.detail and read via
 * detailArray() in the browser, so they need a read PROJECTION, not tables.
 * Five genuinely had nowhere to live.
 *
 * This test proves both halves:
 *   1. All five new tables accept a write as janus_app under RLS, enforce
 *      their constraints, and are append-only where they should be.
 *   2. v_post_call_detail_items projects the eight jsonb-stored kinds, so
 *      those reads have a Postgres path without duplicating data.
 *
 * Usage: node janus/tests/acceptance/at6_remaining_collections.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq, expectReject,
  provisionOrg, provisionUser, provisionAccount, provisionDeal,
  requireEnv, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

try {
  const org = await provisionOrg(mig);
  const se = await provisionUser(mig, {
    slug: "a", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [se.id] });
  const deal = await provisionDeal(mig, {
    slug: "d1", accountId: acc.id, ownerUserId: se.id, orgUnitId: org.teamA });

  const contact = await mig.query(
    `INSERT INTO contact (public_id, account_id, email, name, sync_state)
     VALUES ($1, $2, $3, 'AT Contact', 'synced') RETURNING id`,
    [`${RUN}_ct`, acc.id, `${RUN}@example.test`]);
  const contactId = Number(contact.rows[0].id);

  // -------------------------------------------------------------------------
  // 1. All five tables accept a write as the app, under RLS
  // -------------------------------------------------------------------------
  const written = await asUser(app, se, async (c) => {
    const out = {};
    out.contactEvent = (await c.query(
      `INSERT INTO contact_event (public_id, contact_id, event_type, actor_user_id, payload)
       VALUES ($1, $2, 'field_updated', $3, '{"field":"title"}'::jsonb) RETURNING id`,
      [`${RUN}_ce`, contactId, se.id])).rowCount;
    out.dealSummary = (await c.query(
      `INSERT INTO deal_summary (public_id, deal_id, summary, payload)
       VALUES ($1, $2, 'Deal is progressing', '{"stage":"discovery"}'::jsonb) RETURNING id`,
      [`${RUN}_ds`, deal.id])).rowCount;
    out.accountSummary = (await c.query(
      `INSERT INTO account_summary (public_id, account_id, summary)
       VALUES ($1, $2, 'Healthy account') RETURNING id`,
      [`${RUN}_as`, acc.id])).rowCount;
    out.technicalCommit = (await c.query(
      `INSERT INTO technical_commit (public_id, deal_id, account_id, owner_user_id,
                                     org_unit_id, payload)
       VALUES ($1, $2, $3, $4, $5, '{"committed":true}'::jsonb) RETURNING id`,
      [`${RUN}_tc`, deal.id, acc.id, se.id, org.teamA])).rowCount;
    out.arrOverride = (await c.query(
      `INSERT INTO arr_override (public_id, deal_id, previous_value, new_value,
                                 reason, created_by)
       VALUES ($1, $2, 1000, 2500, 'Customer confirmed wider scope', $3) RETURNING id`,
      [`${RUN}_ao`, deal.id, se.id])).rowCount;
    return out;
  });

  checkEq("AT-6.1a contact_event accepts a write as janus_app", written.contactEvent, 1);
  checkEq("AT-6.1b deal_summary accepts a write", written.dealSummary, 1);
  checkEq("AT-6.1c account_summary accepts a write", written.accountSummary, 1);
  checkEq("AT-6.1d technical_commit accepts a write", written.technicalCommit, 1);
  checkEq("AT-6.1e arr_override accepts a write", written.arrOverride, 1);

  // -------------------------------------------------------------------------
  // 2. One row per deal / account, enforced rather than trusted
  //
  // The store upserts these on a natural key (dealId / accountId), so a second
  // row for the same parent is a bug the database should refuse.
  // -------------------------------------------------------------------------
  await expectReject(mig, "AT-6.2a a second deal_summary for one deal is rejected",
    `INSERT INTO deal_summary (public_id, deal_id, summary) VALUES ($1, $2, 'dupe')`,
    [`${RUN}_ds2`, deal.id], "23505");
  await expectReject(mig, "AT-6.2b a second account_summary for one account is rejected",
    `INSERT INTO account_summary (public_id, account_id, summary) VALUES ($1, $2, 'dupe')`,
    [`${RUN}_as2`, acc.id], "23505");
  await expectReject(mig, "AT-6.2c a second technical_commit for one deal is rejected",
    `INSERT INTO technical_commit (public_id, deal_id, account_id, owner_user_id, org_unit_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [`${RUN}_tc2`, deal.id, acc.id, se.id, org.teamA], "23505");

  // -------------------------------------------------------------------------
  // 3. Append-only where it matters
  //
  // A contact history and an ARR override are evidence. Evidence that can be
  // edited is not evidence.
  // -------------------------------------------------------------------------
  await expectReject(app, "AT-6.3a contact_event cannot be UPDATEd by the app",
    `UPDATE contact_event SET payload = '{}'::jsonb WHERE public_id = $1`,
    [`${RUN}_ce`], "42501");
  await expectReject(app, "AT-6.3b contact_event cannot be DELETEd by the app",
    `DELETE FROM contact_event WHERE public_id = $1`, [`${RUN}_ce`], "42501");
  await expectReject(app, "AT-6.3c arr_override cannot be UPDATEd by the app",
    `UPDATE arr_override SET new_value = 9999 WHERE public_id = $1`,
    [`${RUN}_ao`], "42501");

  // -------------------------------------------------------------------------
  // 4. Constraints that carry real rules
  // -------------------------------------------------------------------------
  await expectReject(mig, "AT-6.4a an ARR override that changes nothing is rejected",
    `INSERT INTO arr_override (public_id, deal_id, previous_value, new_value, reason)
     VALUES ($1, $2, 500, 500, 'no change')`,
    [`${RUN}_ao_same`, deal.id], "23514");
  await expectReject(mig, "AT-6.4b a negative ARR override is rejected",
    `INSERT INTO arr_override (public_id, deal_id, previous_value, new_value, reason)
     VALUES ($1, $2, 500, -1, 'negative')`,
    [`${RUN}_ao_neg`, deal.id], "23514");
  await expectReject(mig, "AT-6.4c an unknown contact_event type is rejected",
    `INSERT INTO contact_event (public_id, contact_id, event_type)
     VALUES ($1, $2, 'invented_event')`,
    [`${RUN}_ce_bad`, contactId], "23514");

  // -------------------------------------------------------------------------
  // 5. The eight jsonb-stored kinds have a read path — no tables needed
  //
  // This is the half that saved building eight tables. The data is already in
  // post_call.detail; the view projects it, which is what detailArray() does
  // in the browser.
  // -------------------------------------------------------------------------
  const kinds = await mig.query(
    `SELECT item_kind, count(*)::int n FROM v_post_call_detail_items
      GROUP BY 1 ORDER BY 2 DESC`);
  const byKind = Object.fromEntries(kinds.rows.map((r) => [r.item_kind, r.n]));

  check("AT-6.5a the projection view returns real items",
        kinds.rows.length > 0,
        `${kinds.rows.length} kind(s), ${kinds.rows.reduce((a, r) => a + r.n, 0)} item(s)`);

  // At least some of the eight must actually be present in live data,
  // otherwise the view is untested however well it is written.
  const EIGHT = ["videoFacts", "timelineSegments", "timelineMarkers", "followUps",
                 "momDrafts", "dealSignals", "whatWorks", "arrLines"];
  const present = EIGHT.filter((k) => byKind[k] > 0);
  check("AT-6.5b jsonb-stored kinds are projectable from real post_calls",
        present.length > 0,
        present.length
          ? present.map((k) => `${k}=${byKind[k]}`).join(", ")
          : "none present — the view is untested against live data");

  // A projected item must be filterable by call, which is what every
  // listXByCall method needs.
  if (present.length) {
    const k = present[0];
    const one = await mig.query(
      `SELECT call_public_id, item_index, item FROM v_post_call_detail_items
        WHERE item_kind = $1 LIMIT 1`, [k]);
    check(`AT-6.5c a ${k} item carries its call and ordinal`,
          one.rowCount === 1 && !!one.rows[0].call_public_id
            && Number.isInteger(one.rows[0].item_index),
          one.rowCount ? `call=${one.rows[0].call_public_id} index=${one.rows[0].item_index}` : "no row");
  }

  // -------------------------------------------------------------------------
  // 6. RLS still holds on the new tables
  // -------------------------------------------------------------------------
  const noCtx = await app.query(
    `SELECT count(*)::int n FROM contact_event WHERE public_id = $1`, [`${RUN}_ce`]);
  checkEq("AT-6.6 a session with no context reads 0 contact_events (fail-closed)",
          noCtx.rows[0].n, 0);

  process.exitCode = summary("AT-6 remaining collections") ? 0 : 1;
} finally {
  // Ordered by dependency; these are append-only for the app but the
  // migration role can clean up its own fixtures.
  for (const sql of [
    `DELETE FROM arr_override WHERE public_id LIKE '${RUN}\\_%'`,
    `DELETE FROM technical_commit WHERE public_id LIKE '${RUN}\\_%'`,
    `DELETE FROM account_summary WHERE public_id LIKE '${RUN}\\_%'`,
    `DELETE FROM deal_summary WHERE public_id LIKE '${RUN}\\_%'`,
    `DELETE FROM contact_event WHERE public_id LIKE '${RUN}\\_%'`,
    `DELETE FROM contact WHERE public_id LIKE '${RUN}\\_%'`,
  ]) {
    await mig.query(sql).catch((e) =>
      console.error(`cleanup: ${String(e.message).split("\n")[0]}`));
  }
  await teardown(mig);
  await app.end();
  await mig.end();
}
