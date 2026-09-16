#!/usr/bin/env node

import assert from "node:assert/strict";
import { ROLLUP_USER_USAGE_SQL, defaultUsageDates, rollupUserUsage } from "./rollup-user-usage.mjs";

class MockClient {
  constructor(rows = []) {
    this.rows = rows;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql);
    this.queries.push({ text, params });
    if (text === ROLLUP_USER_USAGE_SQL) {
      assert.deepEqual(params, [["2026-09-06", "2026-09-07"]]);
      return {
        rows: this.rows,
        rowCount: this.rows.length,
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

const mockRows = [
  {
    usage_date: "2026-09-07",
    user_id: 101,
    email: "se@example.com",
    post_calls: 2,
    pre_calls: 1,
    ai_runs: 3,
    input_tokens: 1200,
    output_tokens: 450,
    cost_usd: "0.123456",
    avg_score: "1.50",
    logins: 2,
    first_login_at: "2026-09-07T08:00:00.000Z",
    last_login_at: "2026-09-07T09:00:00.000Z",
  },
];

const dates = defaultUsageDates(new Date("2026-09-07T12:00:00.000Z"));
assert.deepEqual(dates, ["2026-09-06", "2026-09-07"]);

const client = new MockClient(mockRows);
const rows = await rollupUserUsage(client, dates);
assert.equal(rows.length, 1);
assert.equal(rows[0].post_calls, 2);
assert.equal(rows[0].pre_calls, 1);
assert.equal(rows[0].ai_runs, 3);
assert.equal(rows[0].input_tokens, 1200);
assert.equal(rows[0].output_tokens, 450);
assert.equal(rows[0].cost_usd, "0.123456");
assert.equal(rows[0].avg_score, "1.50");
assert.equal(rows[0].logins, 2);

assert.equal(client.queries[0].text, "BEGIN");
assert.match(client.queries[1].text, /set_config\('app\.is_admin', 'true'/);
assert.match(client.queries[2].text, /DELETE FROM user_usage_daily/);
assert.equal(client.queries[3].text, ROLLUP_USER_USAGE_SQL);
assert.equal(client.queries[4].text, "COMMIT");

for (const table of ["activity", "post_call", "pre_call", "ai_run", "user_usage_logins"]) {
  assert.match(ROLLUP_USER_USAGE_SQL, new RegExp(`\\b${table}\\b`));
}

console.log("PASS user usage rollup mock test");
