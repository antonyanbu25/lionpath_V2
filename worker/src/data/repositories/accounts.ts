/**
 * accounts read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedGetDoc, cachedQuery } from "../cache";
import { getDoc, getDb, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";
import { ACCOUNT_LIST_FIELDS } from "../field-masks";

const COL = "accounts";

export async function getAccount(id: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  return cachedGetDoc(COL, id, () => getDoc(COL, id, env));
}

export async function listAccounts(env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery(COL, { listAll: true }, async () => {
    const db = await getDb(env);
    const snap = await db.collection(COL).select(...ACCOUNT_LIST_FIELDS).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as FirestoreDoc))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  });
}

export function projectAccountListRow(row: FirestoreDoc): FirestoreDoc {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : undefined;
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    slug: row.slug,
    updatedAt: row.updatedAt,
    ...(metadata ? { metadata } : {}),
  };
}

export async function findAccountBySlug(slug: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  const key = String(slug || "").trim();
  if (!key) return null;

  const direct = await cachedQuery(COL, { slug: key }, () =>
    queryBy(COL, [{ field: "slug", op: "==", value: key }], undefined, 1, env),
  );
  if (direct[0]) return direct[0];

  const aliased = await cachedQuery(COL, { slugAlias: key }, () =>
    queryBy(
      COL,
      [{ field: "metadata.slugAliases", op: "array-contains", value: key }],
      undefined,
      1,
      env,
    ),
  );
  return aliased[0] || null;
}

export async function findAccountsByDomain(domain: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  const key = String(domain || "").trim().toLowerCase();
  if (!key) return [];
  const rows = await cachedQuery(COL, { domain: key }, () =>
    queryBy(COL, [{ field: "domain", op: "==", value: key }], undefined, undefined, env),
  );
  return rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function getAccountSummaryByAccount(
  accountId: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc | null> {
  const rows = await cachedQuery("accountSummaries", { accountId }, () =>
    queryBy("accountSummaries", [{ field: "accountId", op: "==", value: accountId }], undefined, 1, env),
  );
  return rows[0] || null;
}
