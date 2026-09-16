/**
 * Types for rollup-user-usage.mjs, so src/routes/internal-usage.ts can import
 * it without `any`.
 *
 * The logic deliberately stays in the .mjs rather than moving into src/: the
 * README documents `node worker/scripts/rollup-user-usage.mjs`, and
 * scripts/test-user-usage.mjs imports it under bare node. Neither can load a
 * .ts module, so moving it would break both to satisfy an import direction.
 * A hand-written declaration is the cheaper trade, and it keeps ONE copy of
 * the aggregation SQL — two copies is how you get two different answers to
 * "how much did we use".
 */

import type { PoolClient } from "pg";

/** [yesterday, today] as YYYY-MM-DD, both UTC. */
export function defaultUsageDates(now?: Date): string[];

/** Every YYYY-MM-DD from `from` to `to` inclusive, both UTC. Throws if from > to. */
export function dateRange(from: string, to: string): string[];

/** Parses --date=, or --from= with --to=, from argv. Null when neither is given. */
export function parseCliDates(argv: string[]): string[] | null;

/** The aggregation query. Takes one parameter: a date[] of YYYY-MM-DD. */
export const ROLLUP_USER_USAGE_SQL: string;

/**
 * Recompute user_usage_daily for `dates`. Opens and commits its OWN
 * transaction and sets its own app.* session variables, so pass a raw pooled
 * client — do NOT wrap this in withUnrestrictedSystemContext or the script's
 * COMMIT will commit the outer transaction.
 */
export function rollupUserUsage(client: PoolClient, dates?: string[]): Promise<unknown[]>;

export function runCli(): Promise<void>;
