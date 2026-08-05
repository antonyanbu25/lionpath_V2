/**
 * Per-user daily token budget — Firestore-backed circuit breaker.
 * Checked before every wrapped LLM generate(); blocks spend on breach.
 */

import {
  dailyTokenBudgetEnabled,
  dailyTokenBudgetLimit,
  dailyTokenBudgetReserve,
  utcDateKey,
  type CostControlEnv,
} from "../cost-control-config";
import { logWarn } from "../logger";
import { firestoreAdminReady, getDb, type FirestoreEnv } from "./firestore-admin";

const COLLECTION = "userDailyTokenUsage";

export class DailyTokenBudgetExceededError extends Error {
  readonly status = 429;
  readonly code = "DAILY_TOKEN_BUDGET_EXCEEDED";

  constructor(limit: number, used: number) {
    super(
      `Daily analysis limit reached (${used.toLocaleString()} / ${limit.toLocaleString()} tokens today). ` +
        "Try again tomorrow or contact your director.",
    );
    this.name = "DailyTokenBudgetExceededError";
  }
}

export class DailyTokenBudgetUnavailableError extends Error {
  readonly status = 503;
  readonly code = "DAILY_TOKEN_BUDGET_UNAVAILABLE";

  constructor() {
    super(
      "Daily analysis limit check is enabled but Firestore admin is not configured. " +
        "Set FIREBASE_PROJECT_ID and service account credentials.",
    );
    this.name = "DailyTokenBudgetUnavailableError";
  }
}

function docId(userId: string, dateKey: string): string {
  return `${userId}_${dateKey}`;
}

function totalTokens(promptTokens: number, outputTokens: number): number {
  return Math.max(0, promptTokens) + Math.max(0, outputTokens);
}

type BudgetEnv = FirestoreEnv & CostControlEnv;

function budgetActive(env?: BudgetEnv): boolean {
  return dailyTokenBudgetEnabled(env);
}

function assertBudgetStoreReady(env?: BudgetEnv): void {
  if (!budgetActive(env)) return;
  if (!firestoreAdminReady(env)) {
    throw new DailyTokenBudgetUnavailableError();
  }
}

/**
 * Reserve tokens before an LLM call. Returns a release function to settle actual usage.
 * When budget is disabled or userId is missing, returns a no-op release.
 */
export async function reserveDailyTokenBudget(
  env: BudgetEnv | undefined,
  userId: string | undefined,
  reserveTokens?: number,
): Promise<(actualTokens: number) => Promise<void>> {
  if (!userId?.trim() || !budgetActive(env)) {
    return async () => {};
  }

  assertBudgetStoreReady(env);

  const limit = dailyTokenBudgetLimit(env);
  const reserve = reserveTokens ?? dailyTokenBudgetReserve(env);
  const dateKey = utcDateKey();
  const id = docId(userId, dateKey);

  const db = await getDb(env);
  const ref = db.collection(COLLECTION).doc(id);
  const adminMod = await import("firebase-admin/firestore");
  const FieldValue = adminMod.FieldValue;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = Number(snap.data()?.totalTokens) || 0;
    if (used + reserve > limit) {
      throw new DailyTokenBudgetExceededError(limit, used);
    }
    if (snap.exists) {
      tx.update(ref, {
        totalTokens: FieldValue.increment(reserve),
        reservedTokens: FieldValue.increment(reserve),
        updatedAt: Date.now(),
      });
    } else {
      tx.set(ref, {
        userId,
        dateKey,
        totalTokens: reserve,
        reservedTokens: reserve,
        limitTokens: limit,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });

  return async (actualTokens: number) => {
    const delta = actualTokens - reserve;
    try {
      await ref.update({
        totalTokens: FieldValue.increment(delta),
        reservedTokens: FieldValue.increment(-reserve),
        updatedAt: Date.now(),
      });
    } catch (err) {
      logWarn("[token-budget] settle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/** Read current daily usage for admin/debug (non-throwing). */
export async function getDailyTokenUsage(
  env: BudgetEnv | undefined,
  userId: string,
  dateKey = utcDateKey(),
): Promise<{ totalTokens: number; limitTokens: number } | null> {
  if (!budgetActive(env)) return null;
  if (!firestoreAdminReady(env)) return null;
  try {
    const db = await getDb(env);
    const snap = await db.collection(COLLECTION).doc(docId(userId, dateKey)).get();
    if (!snap.exists) {
      return { totalTokens: 0, limitTokens: dailyTokenBudgetLimit(env) };
    }
    const data = snap.data() || {};
    return {
      totalTokens: Number(data.totalTokens) || 0,
      limitTokens: Number(data.limitTokens) || dailyTokenBudgetLimit(env),
    };
  } catch {
    return null;
  }
}

export { totalTokens };
