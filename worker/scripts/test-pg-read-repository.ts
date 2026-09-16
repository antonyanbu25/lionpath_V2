#!/usr/bin/env tsx
/**
 * Lane C regression coverage for the ADR-008 PG read repository.
 *
 * The implementation may land in a parallel lane, so this file avoids a static
 * import of read-repository.ts. When the module is present, the assertions below
 * exercise the planned createPostgresReadRepository(pool) contract with a mock
 * pg pool.
 */
import assert from "node:assert/strict";

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number };
type QueryCall = { text: string; values: unknown[] };

const ACCOUNT_ROW = {
  id: 101,
  public_id: "acct_1",
  publicId: "acct_1",
  name: "Acme Inc",
  domain: "acme.example",
  slug: "acme",
  industry: "SaaS",
  health_data: { health: "green" },
  healthData: { health: "green" },
  external_ref: "sf:acct_1",
  externalRef: "sf:acct_1",
};

const CONTACT_ROWS = [
  {
    id: 201,
    public_id: "ct_1",
    publicId: "ct_1",
    account_public_id: "acct_1",
    accountPublicId: "acct_1",
    email: "buyer@acme.example",
    name: "Asha Buyer",
    title: "VP Sales",
    role: "economic buyer",
  },
  {
    id: 202,
    public_id: "ct_2",
    publicId: "ct_2",
    account_public_id: "acct_1",
    accountPublicId: "acct_1",
    email: "champion@acme.example",
    name: "Chin Champion",
    title: "Director",
    role: "champion",
  },
];

const DEAL_ROW = {
  id: 301,
  public_id: "deal_1",
  publicId: "deal_1",
  account_id: 101,
  account_public_id: "acct_1",
  accountPublicId: "acct_1",
  owner_public_id: "usr_1",
  ownerPublicId: "usr_1",
  org_unit_id: "org_1",
  orgUnitId: "org_1",
  name: "Acme Expansion",
  stage: "proposal",
  status: "active",
  amount: 50000,
  currency_code: "USD",
  currencyCode: "USD",
  extra: { type: "expansion", team: "strategic" },
};

const POST_CALL_ROW = {
  id: 401,
  public_id: "pc_1",
  publicId: "pc_1",
  activity_public_id: "act_1",
  activityPublicId: "act_1",
  transcript_ref: "gs://calls/pc_1.txt",
  transcriptRef: "gs://calls/pc_1.txt",
  analysis: { score: 87, objections: ["price"] },
  detail: { summary: "Strong technical validation", nextSteps: ["security review"] },
  pipeline_state: "detail_done",
  pipelineState: "detail_done",
  analysis_shape_version: "1",
  analysisShapeVersion: "1",
  detail_shape_version: "2",
  detailShapeVersion: "2",
};

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

function result(rows: Array<Record<string, unknown>>): QueryResult {
  return { rows, rowCount: rows.length };
}

function createMockPool() {
  const calls: QueryCall[] = [];
  const client = {
    async query(textOrConfig: string | { text?: string; values?: unknown[] }, values?: unknown[]): Promise<QueryResult> {
      const text = typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text ?? "";
      const queryValues = values ?? (typeof textOrConfig === "string" ? [] : textOrConfig.values ?? []);
      calls.push({ text, values: queryValues });
      const sql = normalizeSql(text);

      if (sql === "begin" || sql === "commit" || sql === "rollback" || sql.includes("set_config(")) {
        return result([]);
      }
      if (sql.includes("from account") && (sql.includes("slug") || sql.includes("domain") || sql.includes("public_id"))) {
        return result([ACCOUNT_ROW]);
      }
      if (sql.includes("from contact")) {
        return result(CONTACT_ROWS);
      }
      if (sql.includes("from post_call") || sql.includes("join post_call")) {
        return result([POST_CALL_ROW]);
      }
      if (sql.includes("from deal") || sql.includes("join deal")) {
        return result([DEAL_ROW]);
      }
      if (sql.includes("from activity")) {
        return result([{ public_id: "act_1", publicId: "act_1", subject: "Discovery call" }]);
      }
      if (sql.includes("from app_user")) {
        return result([{ public_id: "usr_1", publicId: "usr_1", email: "owner@example.com", display_name: "Owner One" }]);
      }
      return result([]);
    },
    release() {},
  };
  const pool = {
    calls,
    async query(text: string, values?: unknown[]) {
      return client.query(text, values);
    },
    async connect() {
      return client;
    },
  };
  return pool;
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return pickRecord(value[0]);
  if (value && typeof value === "object") {
    if ("deal" in value && (value as { deal?: unknown }).deal) {
      return pickRecord((value as { deal?: unknown }).deal);
    }
    if ("postCall" in value && (value as { postCall?: unknown }).postCall) {
      return pickRecord((value as { postCall?: unknown }).postCall);
    }
    return value as Record<string, unknown>;
  }
  assert.fail(`Expected object-like result, got ${typeof value}`);
}

function field(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

async function optionalImport(specifier: string): Promise<Record<string, unknown> | null> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<Record<string, unknown>>;
  try {
    return await dynamicImport(specifier);
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

async function callMethod(repo: Record<string, unknown>, method: string, ...args: unknown[]): Promise<unknown> {
  const fn = repo[method];
  assert.equal(typeof fn, "function", `PostgresReadRepository must expose ${method}()`);
  return (fn as (...args: unknown[]) => Promise<unknown>).apply(repo, args);
}

async function main() {
  const module = await optionalImport("../src/data/persistence/read-repository.ts");
  if (!module) {
    console.log("test-pg-read-repository: pending (worker/src/data/persistence/read-repository.ts not present)");
    return;
  }

  const factory = module.createPostgresReadRepository;
  assert.equal(typeof factory, "function", "read-repository.ts must export createPostgresReadRepository(pool)");
  const pool = createMockPool();
  const repo = (factory as (pool: unknown, session: unknown, env?: unknown) => Record<string, unknown>)(
    pool,
    { userId: "usr_test", orgUnitPath: "/org_freshworks_se", isAdmin: true },
    undefined,
  );

  const account = pickRecord(await callMethod(repo, "findAccountBySlug", "acme"));
  assert.equal(field(account, "publicId", "public_id", "id"), "acct_1");
  assert.equal(account.name, "Acme Inc");
  assert.equal(account.slug, "acme");
  assert.equal(account.domain, "acme.example");

  const contacts = await callMethod(repo, "listContactsByAccount", "acct_1");
  assert.ok(Array.isArray(contacts), "listContactsByAccount must return an array");
  assert.equal(contacts.length, 2);
  assert.equal(field(pickRecord(contacts[0]), "email"), "buyer@acme.example");
  assert.equal(field(pickRecord(contacts[0]), "accountPublicId", "account_public_id"), "acct_1");

  const dealDetail = pickRecord(await callMethod(repo, "getDealDetail", "deal_1"));
  assert.equal(field(dealDetail, "publicId", "public_id", "id"), "deal_1");
  assert.equal(field(dealDetail, "accountPublicId", "account_public_id"), "acct_1");
  assert.equal(field(dealDetail, "stage"), "proposal");

  const postCallDetail = pickRecord(await callMethod(repo, "getPostCallDetail", "pc_1"));
  assert.deepEqual(field(postCallDetail, "analysis"), POST_CALL_ROW.analysis);
  assert.deepEqual(field(postCallDetail, "detail"), POST_CALL_ROW.detail);
  assert.equal(field(postCallDetail, "transcriptRef", "transcript_ref"), "gs://calls/pc_1.txt");

  assert.ok(pool.calls.length > 0, "repository should issue pg queries through the supplied pool");
  console.log("test-pg-read-repository: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
