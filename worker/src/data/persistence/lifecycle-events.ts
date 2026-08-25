/**
 * lifecycleEvents -> SQL mapping (ADR-007 section 2).
 *
 * Firestore `lifecycleEvents` is an append-only per-lifecycle event stream.
 * In SQL:
 *   - stage transitions are captured automatically by the trg_deal_stage_history
 *     trigger on deal — manual writes would double-count, so they are SKIPPED.
 *   - everything else (prep created, post-call analyzed, task events, notes)
 *     becomes an activity row with activity_type + JSONB description.
 *
 * The UI timeline reads activity + deal_stage_history unioned by timestamp.
 */

import type { PgClient } from "./postgres-pool";
import { resolveInternalId } from "./id-registry";

const STAGE_EVENT_TYPES = new Set(["stage_change", "stage_changed", "stage"]);

export interface LifecycleEventInput {
  id?: string;
  lifecycleId?: string;
  dealId?: string;
  type?: string;
  actorId?: string;
  ownerId?: string;
  accountId?: string;
  teamId?: string;
  orgId?: string;
  note?: string;
  data?: Record<string, unknown>;
  createdAt?: string | number;
}

/**
 * Map one lifecycle event to its SQL target.
 * Returns 'stage_history' (skipped — trigger owns it), 'activity' (inserted),
 * or 'ignored' (unmappable — missing FKs).
 */
export async function applyLifecycleEvent(
  client: PgClient,
  event: LifecycleEventInput,
): Promise<"stage_history" | "activity" | "ignored"> {
  const type = String(event.type || "");
  if (STAGE_EVENT_TYPES.has(type)) {
    return "stage_history"; // trg_deal_stage_history already recorded it
  }

  const dealPublicId = event.dealId || event.lifecycleId; // lc_* ids became deal public_ids
  const ownerPublicId = event.actorId || event.ownerId;
  const accountPublicId = event.accountId;
  const orgUnitId = event.teamId || event.orgId;
  if (!ownerPublicId || !accountPublicId || !orgUnitId) return "ignored";

  let dealId: number | null = null;
  let accountId: number;
  let ownerId: number;
  try {
    if (dealPublicId) dealId = await resolveInternalId(client, "deal", dealPublicId);
    accountId = await resolveInternalId(client, "account", accountPublicId);
    ownerId = await resolveInternalId(client, "app_user", ownerPublicId);
  } catch {
    return "ignored"; // parent not migrated yet
  }

  const occurredAt =
    typeof event.createdAt === "number"
      ? new Date(event.createdAt).toISOString()
      : event.createdAt || new Date().toISOString();

  await client.query(
    `INSERT INTO activity (public_id, deal_id, account_id, owner_user_id, org_unit_id, activity_type, subject, description, occurred_at)
     VALUES ($1, $2, $3, $4, $5, 'task', $6, $7, $8)
     ON CONFLICT (public_id) DO NOTHING`,
    [
      event.id ? `lev_${event.id}` : `lev_${dealPublicId}_${type}_${occurredAt}`,
      dealId,
      accountId,
      ownerId,
      orgUnitId,
      `lifecycle:${type || "event"}`,
      JSON.stringify({ note: event.note ?? null, ...event.data }),
      occurredAt,
    ],
  );
  return "activity";
}
