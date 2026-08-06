/**
 * Sweep deals past NB grace period — archive and transition account programPhase.
 */

import type { FirestoreEnv } from "../data/firestore-admin";
import { queryBy, setDoc, getDoc } from "../data/firestore-admin";

const MS_PER_DAY = 86400000;
const GRACE_DAYS = 90;

export async function runDealGraceSweep(env: FirestoreEnv, now = Date.now()): Promise<{
  scanned: number;
  transitioned: number;
}> {
  const cutoff = now - GRACE_DAYS * MS_PER_DAY;
  const graceDeals = await queryBy(
    "deals",
    [
      { field: "status", op: "==", value: "closed_won_grace" },
      { field: "wonAt", op: "<=", value: cutoff },
    ],
    undefined,
    undefined,
    env,
  );

  let transitioned = 0;
  for (const deal of graceDeals) {
    const dealId = String(deal.id);
    const accountId = String(deal.accountId || "");
    const existing = await getDoc("deals", dealId, env);
    if (!existing) continue;
    await setDoc("deals", dealId, { ...existing, status: "archived", updatedAt: now }, env);

    if (accountId) {
      const activeNb = await queryBy(
        "deals",
        [
          { field: "accountId", op: "==", value: accountId },
          { field: "type", op: "==", value: "new_business" },
          { field: "status", op: "==", value: "active" },
        ],
        1,
        undefined,
        env,
      );
      if (!activeNb.length) {
        const acct = await getDoc("accounts", accountId, env);
        if (acct) {
          await setDoc(
            "accounts",
            accountId,
            { ...acct, programPhase: "expansion", updatedAt: now },
            env,
          );
        }
      }
    }
    transitioned += 1;
    console.log(JSON.stringify({ event: "deal_grace_sweep", dealId, accountId }));
  }

  return { scanned: graceDeals.length, transitioned };
}
