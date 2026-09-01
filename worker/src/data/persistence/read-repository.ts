import { isNodeRuntime } from "../../video/capability";
import type { PgClient, PgPool, PostgresEnv } from "./postgres-pool";
import { postgresReady } from "./postgres-pool";
import { withSessionContext, type SqlSession } from "./session-context";
import type {
  DealReadDetail,
  DomainListScope,
  DomainReadDoc,
  PersistenceReadPort,
  PostCallReadDetail,
} from "./types";

type Queryable = Pick<PgClient, "query">;
type Row = Record<string, unknown>;

export interface PersistenceReadEnv extends PostgresEnv {
  PERSISTENCE_READ_MODE?: string;
}

function millis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const n = Date.parse(String(value));
  return Number.isFinite(n) ? n : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayFromDetail(detail: unknown, key: string): DomainReadDoc[] {
  const value = objectOrEmpty(detail)[key];
  return Array.isArray(value) ? (value.filter((row) => row && typeof row === "object") as DomainReadDoc[]) : [];
}

function compactDoc(doc: DomainReadDoc): DomainReadDoc {
  const out: DomainReadDoc = { id: doc.id };
  for (const [key, value] of Object.entries(doc)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function accountDoc(row: Row): DomainReadDoc {
  const healthData = objectOrEmpty(row.health_data);
  const metadata = objectOrEmpty(healthData.metadata);
  return compactDoc({
    id: String(row.public_id),
    name: row.name,
    domain: row.domain ?? undefined,
    slug: row.slug ?? undefined,
    industry: row.industry ?? undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    healthData: Object.keys(healthData).length ? healthData : undefined,
    externalRef: row.external_ref ?? undefined,
    createdAt: millis(row.created_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
  });
}

function contactDoc(row: Row): DomainReadDoc {
  return compactDoc({
    id: String(row.public_id),
    accountId: row.account_public_id,
    accountPublicId: row.account_public_id,
    email: row.email,
    name: row.name ?? undefined,
    title: row.title ?? undefined,
    role: row.role ?? undefined,
    createdAt: millis(row.created_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
  });
}

function dealType(row: Row): string {
  const detail = objectOrEmpty(row.tc_detail);
  return String(detail.type || detail.dealType || "new_business");
}

function dealDoc(row: Row): DomainReadDoc {
  return compactDoc({
    id: String(row.public_id),
    accountId: row.account_public_id,
    accountPublicId: row.account_public_id,
    accountName: row.account_name ?? undefined,
    ownerId: row.owner_public_id,
    ownerName: row.owner_name ?? undefined,
    teamId: row.org_unit_id,
    orgId: row.parent_org_unit_id ?? row.org_unit_id,
    type: dealType(row),
    stage: row.stage,
    status: row.status,
    title: row.name,
    amount: numberOrNull(row.amount),
    currencyCode: row.currency_code,
    primaryContactId: row.primary_contact_public_id ?? undefined,
    latestQualityScore: numberOrNull(row.latest_quality_score),
    prepCount: numberOrNull(row.prep_count) ?? 0,
    postCallCount: numberOrNull(row.post_call_count) ?? 0,
    openTaskCount: numberOrNull(row.open_task_count) ?? 0,
    metadata: objectOrEmpty(row.tc_detail),
    createdAt: millis(row.created_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
    lastActivityAt: millis(row.last_activity_at) ?? millis(row.updated_at) ?? undefined,
  });
}

function postCallDoc(row: Row): DomainReadDoc {
  const detail = objectOrEmpty(row.detail);
  const analysis = objectOrEmpty(row.analysis);
  return compactDoc({
    id: String(row.public_id),
    activityId: row.activity_public_id,
    ownerId: row.owner_public_id,
    ownerName: row.owner_name ?? undefined,
    teamId: row.org_unit_id,
    orgId: row.parent_org_unit_id ?? row.org_unit_id,
    accountId: row.account_public_id,
    accountName: row.account_name ?? undefined,
    dealId: row.deal_public_id ?? undefined,
    dealTitle: row.deal_name ?? undefined,
    dealStage: row.deal_stage ?? undefined,
    dealType: row.deal_type ?? undefined,
    callType: row.activity_type,
    title: row.subject ?? row.activity_type,
    transcriptRef: row.transcript_ref ?? undefined,
    analysis: Object.keys(analysis).length ? analysis : undefined,
    detail: Object.keys(detail).length ? detail : undefined,
    pipelineState: row.pipeline_state,
    analysisShapeVersion: row.analysis_shape_version ?? undefined,
    detailShapeVersion: row.detail_shape_version ?? undefined,
    callIdentityKey: row.idempotency_key ?? undefined,
    createdAt: millis(row.created_at) ?? millis(row.occurred_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
  });
}

function callSummaryDoc(row: Row): DomainReadDoc {
  const doc = postCallDoc(row);
  const analysis = objectOrEmpty(row.analysis);
  const detail = objectOrEmpty(row.detail);
  return compactDoc({
    ...doc,
    aiShortForm: analysis.summary ?? detail.summary ?? undefined,
    qualityScore: numberOrNull(row.composite_score),
    qipOverall: numberOrNull(row.composite_score),
    provisional: row.pipeline_state !== "signals_done" && row.pipeline_state !== "scoring_done",
    rubricVersion: row.analysis_shape_version ?? undefined,
    followUpCount: arrayFromDetail(detail, "followUps").length,
    objectionCount: arrayFromDetail(detail, "objections").length,
    hasVideoFacts: arrayFromDetail(detail, "videoFacts").length > 0,
  });
}

function taskDoc(row: Row): DomainReadDoc {
  return compactDoc({
    id: String(row.public_id),
    activityId: row.activity_public_id ?? undefined,
    dealId: row.deal_public_id ?? undefined,
    lifecycleId: row.deal_public_id ?? undefined,
    ownerId: row.owner_public_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    dueDate: row.due_date ?? undefined,
    source: row.source,
    taskKey: row.task_key ?? undefined,
    createdAt: millis(row.created_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
  });
}

function productSignalDoc(row: Row): DomainReadDoc {
  return compactDoc({
    id: String(row.public_id),
    callId: row.activity_public_id ?? undefined,
    postCallId: row.post_call_public_id ?? undefined,
    dealId: row.deal_public_id ?? undefined,
    accountId: row.account_public_id,
    ownerId: row.owner_public_id,
    teamId: row.org_unit_id,
    orgId: row.parent_org_unit_id ?? row.org_unit_id,
    source: row.source,
    signalType: row.signal_type,
    signalKey: row.signal_key ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    evidence: row.evidence ?? undefined,
    capabilityArea: row.capability_area ?? undefined,
    status: row.status,
    createdAt: millis(row.created_at) ?? undefined,
    updatedAt: millis(row.updated_at) ?? undefined,
  });
}

function scorecardDoc(row: Row): DomainReadDoc {
  return compactDoc({
    id: String(row.public_id),
    callId: row.activity_public_id,
    activityId: row.activity_public_id,
    ownerId: row.owner_public_id ?? undefined,
    orgId: row.org_unit_id,
    rubricId: row.rubric_id,
    isCurrent: row.is_current,
    compositeScore: numberOrNull(row.composite_score),
    createdAt: millis(row.created_at) ?? undefined,
  });
}

const DEAL_SELECT = `
  SELECT d.*, a.public_id AS account_public_id, a.name AS account_name,
         u.public_id AS owner_public_id, u.display_name AS owner_name,
         ou.parent_id AS parent_org_unit_id,
         pc.public_id AS primary_contact_public_id,
         tr.last_activity_at, tr.call_count AS post_call_count,
         tr.latest_quality_score,
         (SELECT count(*) FROM pre_call pr JOIN activity pa ON pa.id = pr.activity_id WHERE pa.deal_id = d.id) AS prep_count,
         (SELECT count(*) FROM task t WHERE t.deal_id = d.id AND t.deleted_at IS NULL AND t.status <> 'completed') AS open_task_count
  FROM deal d
  JOIN account a ON a.id = d.account_id
  JOIN app_user u ON u.id = d.owner_user_id
  LEFT JOIN org_unit ou ON ou.id = d.org_unit_id
  LEFT JOIN contact pc ON pc.id = d.champion_contact_id
  LEFT JOIN v_deal_traction tr ON tr.deal_id = d.id
`;

const POST_CALL_SELECT = `
  SELECT pc.*, act.public_id AS activity_public_id, act.idempotency_key AS activity_idempotency_key,
         act.activity_type, act.subject, act.occurred_at, act.org_unit_id,
         acc.public_id AS account_public_id, acc.name AS account_name,
         owner.public_id AS owner_public_id, owner.display_name AS owner_name,
         ou.parent_id AS parent_org_unit_id,
         d.public_id AS deal_public_id, d.name AS deal_name, d.stage AS deal_stage,
         d.tc_detail->>'type' AS deal_type,
         s.composite_score
  FROM post_call pc
  JOIN activity act ON act.id = pc.activity_id
  JOIN account acc ON acc.id = act.account_id
  JOIN app_user owner ON owner.id = act.owner_user_id
  LEFT JOIN org_unit ou ON ou.id = act.org_unit_id
  LEFT JOIN deal d ON d.id = act.deal_id
  LEFT JOIN scorecard s ON s.activity_id = act.id AND s.is_current
`;

export class PostgresReadRepository implements PersistenceReadPort {
  constructor(
    private readonly pool: PgPool,
    private readonly session: SqlSession,
    private readonly env?: PostgresEnv,
  ) {}

  private async read<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    return withSessionContext(this.session, fn, this.env, this.pool);
  }

  async listAccounts(): Promise<DomainReadDoc[]> {
    return this.read((client) => this.listAccountsInContext(client));
  }

  async listAccountsInContext(client: Queryable): Promise<DomainReadDoc[]> {
    const res = await client.query(
      `SELECT * FROM account WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
    );
    return (res.rows as Row[]).map(accountDoc);
  }

  async getAccount(id: string): Promise<DomainReadDoc | null> {
    return this.read((client) => this.getAccountInContext(client, id));
  }

  async getAccountInContext(client: Queryable, id: string): Promise<DomainReadDoc | null> {
    const res = await client.query(`SELECT * FROM account WHERE public_id = $1 AND deleted_at IS NULL`, [id]);
    return res.rows[0] ? accountDoc(res.rows[0] as Row) : null;
  }

  async findAccountBySlug(slug: string): Promise<DomainReadDoc | null> {
    const key = String(slug || "").trim();
    if (!key) return null;
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT * FROM account
         WHERE deleted_at IS NULL
           AND (slug = $1 OR health_data->'metadata'->'slugAliases' ? $1)
         ORDER BY updated_at DESC
         LIMIT 1`,
        [key],
      );
      return res.rows[0] ? accountDoc(res.rows[0] as Row) : null;
    });
  }

  async findAccountsByDomain(domain: string): Promise<DomainReadDoc[]> {
    const key = String(domain || "").trim().toLowerCase();
    if (!key) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT * FROM account WHERE deleted_at IS NULL AND lower(domain) = $1 ORDER BY updated_at DESC`,
        [key],
      );
      return (res.rows as Row[]).map(accountDoc);
    });
  }

  async findAccountByDomain(domain: string): Promise<DomainReadDoc | null> {
    const rows = await this.findAccountsByDomain(domain);
    return rows[0] || null;
  }

  async findAccountByName(name: string): Promise<DomainReadDoc | null> {
    const key = String(name || "").trim();
    if (!key) return null;
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT * FROM account WHERE deleted_at IS NULL AND lower(name) = lower($1) ORDER BY updated_at DESC LIMIT 1`,
        [key],
      );
      return res.rows[0] ? accountDoc(res.rows[0] as Row) : null;
    });
  }

  async listContactsByAccount(accountId: string): Promise<DomainReadDoc[]> {
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT c.*, a.public_id AS account_public_id
         FROM contact c JOIN account a ON a.id = c.account_id
         WHERE a.public_id = $1 AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC`,
        [accountId],
      );
      return (res.rows as Row[]).map(contactDoc);
    });
  }

  async findContactsByEmail(email: string): Promise<DomainReadDoc[]> {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT c.*, a.public_id AS account_public_id
         FROM contact c JOIN account a ON a.id = c.account_id
         WHERE c.email = $1 AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC`,
        [key],
      );
      return (res.rows as Row[]).map(contactDoc);
    });
  }

  async findContactByAccountEmail(accountId: string, email: string): Promise<DomainReadDoc | null> {
    const key = String(email || "").trim().toLowerCase();
    if (!accountId || !key) return null;
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT c.*, a.public_id AS account_public_id
         FROM contact c JOIN account a ON a.id = c.account_id
         WHERE a.public_id = $1 AND c.email = $2 AND c.deleted_at IS NULL
         LIMIT 1`,
        [accountId, key],
      );
      return res.rows[0] ? contactDoc(res.rows[0] as Row) : null;
    });
  }

  async listDeals(limitCount = 300): Promise<DomainReadDoc[]> {
    return this.read((client) => this.listDealsInContext(client, limitCount));
  }

  async listDealsInContext(client: Queryable, limitCount = 300): Promise<DomainReadDoc[]> {
    const res = await client.query(
      `${DEAL_SELECT}
       WHERE d.deleted_at IS NULL
       ORDER BY COALESCE(tr.last_activity_at, d.updated_at) DESC
       LIMIT $1`,
      [limitCount],
    );
    return (res.rows as Row[]).map(dealDoc);
  }

  async getDeal(id: string): Promise<DomainReadDoc | null> {
    return this.read((client) => this.getDealInContext(client, id));
  }

  async getDealInContext(client: Queryable, id: string): Promise<DomainReadDoc | null> {
    const res = await client.query(`${DEAL_SELECT} WHERE d.public_id = $1 AND d.deleted_at IS NULL`, [id]);
    return res.rows[0] ? dealDoc(res.rows[0] as Row) : null;
  }

  async listDealsByAccount(accountId: string, ownerId?: string): Promise<DomainReadDoc[]> {
    if (!accountId) return [];
    return this.read(async (client) => {
      const params: unknown[] = [accountId];
      let ownerClause = "";
      if (ownerId) {
        params.push(ownerId);
        ownerClause = ` AND u.public_id = $${params.length}`;
      }
      const res = await client.query(
        `${DEAL_SELECT}
         WHERE a.public_id = $1 AND d.deleted_at IS NULL${ownerClause}
         ORDER BY COALESCE(tr.last_activity_at, d.updated_at) DESC`,
        params,
      );
      return (res.rows as Row[]).map(dealDoc);
    });
  }

  async listDealsForScope(scope: DomainListScope, limitCount: number): Promise<DomainReadDoc[]> {
    if (scope.ownerId) return this.listDealsByOwner(scope.ownerId, limitCount);
    if (scope.teamId) return this.listDealsByTeam(scope.teamId, limitCount);
    if (scope.orgId) return this.listDealsByOrg(scope.orgId, limitCount);
    return [];
  }

  async listDealsByOwner(ownerId: string, limitCount = 300): Promise<DomainReadDoc[]> {
    return this.listDealsByField("u.public_id", ownerId, limitCount);
  }

  async listDealsByTeam(teamId: string, limitCount = 300): Promise<DomainReadDoc[]> {
    return this.listDealsByField("d.org_unit_id", teamId, limitCount);
  }

  async listDealsByOrg(orgId: string, limitCount = 300): Promise<DomainReadDoc[]> {
    return this.listDealsByField("COALESCE(ou.parent_id, d.org_unit_id)", orgId, limitCount);
  }

  private async listDealsByField(fieldSql: string, value: string, limitCount: number): Promise<DomainReadDoc[]> {
    if (!value) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `${DEAL_SELECT}
         WHERE ${fieldSql} = $1 AND d.deleted_at IS NULL
         ORDER BY COALESCE(tr.last_activity_at, d.updated_at) DESC
         LIMIT $2`,
        [value, limitCount],
      );
      return (res.rows as Row[]).map(dealDoc);
    });
  }

  async findActiveDeal(accountId: string, type: string): Promise<DomainReadDoc | null> {
    if (!accountId) return null;
    return this.read(async (client) => {
      const res = await client.query(
        `${DEAL_SELECT}
         WHERE a.public_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
           AND COALESCE(d.tc_detail->>'type', d.tc_detail->>'dealType', 'new_business') = $2
         ORDER BY d.updated_at DESC
         LIMIT 1`,
        [accountId, type || "new_business"],
      );
      return res.rows[0] ? dealDoc(res.rows[0] as Row) : null;
    });
  }

  async getDealDetail(id: string): Promise<DealReadDetail | null> {
    const deal = await this.getDeal(id);
    if (!deal) return null;
    const [dealSignals, productGaps] = await Promise.all([
      this.listProductSignalsByDeal(id, "feature_request", 50),
      this.listProductSignalsByDeal(id, "product_gap", 500),
    ]);
    return {
      deal,
      summary: null,
      technicalCommit: null,
      dealSignals,
      arrLines: [],
      productGaps,
      whatWorks: [],
    };
  }

  async getLifecycle(id: string): Promise<DomainReadDoc | null> {
    return this.getDeal(id);
  }

  async findActiveLifecycle(accountId: string, type = "new_business"): Promise<DomainReadDoc | null> {
    return this.findActiveDeal(accountId, type);
  }

  async listLifecycleEvents(_lifecycleId: string): Promise<DomainReadDoc[]> {
    return [];
  }

  async listPrepBriefsByLifecycle(lifecycleId: string): Promise<DomainReadDoc[]> {
    if (!lifecycleId) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT pr.*, act.public_id AS activity_public_id, act.deal_id, d.public_id AS deal_public_id,
                act.owner_user_id, u.public_id AS owner_public_id, act.account_id, acc.public_id AS account_public_id
         FROM pre_call pr
         JOIN activity act ON act.id = pr.activity_id
         LEFT JOIN deal d ON d.id = act.deal_id
         JOIN app_user u ON u.id = act.owner_user_id
         JOIN account acc ON acc.id = act.account_id
         WHERE d.public_id = $1
         ORDER BY pr.created_at DESC`,
        [lifecycleId],
      );
      return (res.rows as Row[]).map((row) => compactDoc({
        id: String(row.public_id),
        activityId: row.activity_public_id,
        lifecycleId: row.deal_public_id ?? undefined,
        dealId: row.deal_public_id ?? undefined,
        ownerId: row.owner_public_id,
        accountId: row.account_public_id,
        researchBrief: row.research_brief ?? undefined,
        inputSnapshot: row.input_snapshot ?? undefined,
        generatedAt: millis(row.generated_at) ?? undefined,
        createdAt: millis(row.created_at) ?? undefined,
      }));
    });
  }

  async listPostCallsByLifecycle(lifecycleId: string, limitCount = 200): Promise<DomainReadDoc[]> {
    return this.listPostCallsByDeal(lifecycleId, limitCount);
  }

  async listPostCallsByAccount(accountId: string, limitCount = 80): Promise<DomainReadDoc[]> {
    if (!accountId) return [];
    return this.listPostCallsByField("acc.public_id", accountId, limitCount, false);
  }

  async listPostCallsByDeal(dealId: string, limitCount = 50): Promise<DomainReadDoc[]> {
    if (!dealId) return [];
    return this.listPostCallsByField("d.public_id", dealId, limitCount, false);
  }

  async listPostCalls(limitCount = 200): Promise<DomainReadDoc[]> {
    return this.read((client) => this.listPostCallsInContext(client, limitCount));
  }

  async listPostCallsInContext(client: Queryable, limitCount = 200): Promise<DomainReadDoc[]> {
    const res = await client.query(
      `${POST_CALL_SELECT}
       ORDER BY pc.created_at DESC
       LIMIT $1`,
      [limitCount],
    );
    return (res.rows as Row[]).map(callSummaryDoc);
  }

  async listCallSummariesForScope(scope: DomainListScope, limitCount: number): Promise<DomainReadDoc[]> {
    if (scope.ownerId) return this.listPostCallsByField("owner.public_id", scope.ownerId, limitCount, true);
    if (scope.teamId) return this.listPostCallsByField("act.org_unit_id", scope.teamId, limitCount, true);
    if (scope.orgId) return this.listPostCallsByField("COALESCE(ou.parent_id, act.org_unit_id)", scope.orgId, limitCount, true);
    return [];
  }

  private async listPostCallsByField(
    fieldSql: string,
    value: string,
    limitCount: number,
    summary: boolean,
  ): Promise<DomainReadDoc[]> {
    if (!value) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `${POST_CALL_SELECT}
         WHERE ${fieldSql} = $1
         ORDER BY pc.created_at DESC
         LIMIT $2`,
        [value, limitCount],
      );
      return (res.rows as Row[]).map(summary ? callSummaryDoc : postCallDoc);
    });
  }

  async findPostCallByIdentity(ownerId: string, callIdentityKey: string): Promise<DomainReadDoc | null> {
    if (!ownerId || !callIdentityKey) return null;
    return this.read(async (client) => {
      const res = await client.query(
        `${POST_CALL_SELECT}
         WHERE owner.public_id = $1 AND (pc.idempotency_key = $2 OR act.idempotency_key = $2)
         LIMIT 1`,
        [ownerId, callIdentityKey],
      );
      return res.rows[0] ? postCallDoc(res.rows[0] as Row) : null;
    });
  }

  async listTasksByLifecycle(lifecycleId: string): Promise<DomainReadDoc[]> {
    if (!lifecycleId) return [];
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT t.*, act.public_id AS activity_public_id, d.public_id AS deal_public_id,
                u.public_id AS owner_public_id
         FROM task t
         LEFT JOIN activity act ON act.id = t.activity_id
         LEFT JOIN deal d ON d.id = t.deal_id
         JOIN app_user u ON u.id = t.owner_user_id
         WHERE d.public_id = $1 AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC`,
        [lifecycleId],
      );
      return (res.rows as Row[]).map(taskDoc);
    });
  }

  async listTasks(limitCount = 200): Promise<DomainReadDoc[]> {
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT t.*, act.public_id AS activity_public_id, d.public_id AS deal_public_id,
                u.public_id AS owner_public_id
         FROM task t
         LEFT JOIN activity act ON act.id = t.activity_id
         LEFT JOIN deal d ON d.id = t.deal_id
         JOIN app_user u ON u.id = t.owner_user_id
         WHERE t.deleted_at IS NULL
         ORDER BY t.created_at DESC
         LIMIT $1`,
        [limitCount],
      );
      return (res.rows as Row[]).map(taskDoc);
    });
  }

  async getPostCallDetail(id: string): Promise<PostCallReadDetail | null> {
    const raw = await this.read(async (client) => {
      const res = await client.query(`${POST_CALL_SELECT} WHERE pc.public_id = $1`, [id]);
      return res.rows[0] ? (res.rows[0] as Row) : null;
    });
    if (!raw) return null;
    const postCall = postCallDoc(raw);
    const detail = objectOrEmpty(raw.detail);
    const [scorecards, arrLines, dealSignals] = await Promise.all([
      this.listScorecardsByPostCall(id),
      Promise.resolve(arrayFromDetail(detail, "arrLines")),
      Promise.resolve(arrayFromDetail(detail, "dealSignals")),
    ]);
    return {
      postCall,
      scorecards,
      videoFacts: arrayFromDetail(detail, "videoFacts"),
      timelineSegments: arrayFromDetail(detail, "timelineSegments"),
      timelineMarkers: arrayFromDetail(detail, "timelineMarkers"),
      followUps: arrayFromDetail(detail, "followUps"),
      objections: arrayFromDetail(detail, "objections"),
      momDrafts: arrayFromDetail(detail, "momDrafts"),
      meddpiccDeltas: arrayFromDetail(detail, "meddpiccDeltas"),
      tcDeltas: arrayFromDetail(detail, "tcDeltas"),
      arrLines,
      dealSignals,
    };
  }

  private async listScorecardsByPostCall(postCallId: string): Promise<DomainReadDoc[]> {
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT s.*, act.public_id AS activity_public_id, u.public_id AS owner_public_id
         FROM scorecard s
         JOIN post_call pc ON pc.activity_id = s.activity_id
         JOIN activity act ON act.id = s.activity_id
         LEFT JOIN app_user u ON u.id = s.owner_user_id
         WHERE pc.public_id = $1
         ORDER BY s.created_at DESC`,
        [postCallId],
      );
      return (res.rows as Row[]).map(scorecardDoc);
    });
  }

  private async listProductSignalsByDeal(
    dealId: string,
    signalType: string,
    limitCount: number,
  ): Promise<DomainReadDoc[]> {
    return this.read(async (client) => {
      const res = await client.query(
        `SELECT ps.*, act.public_id AS activity_public_id, pc.public_id AS post_call_public_id,
                d.public_id AS deal_public_id, acc.public_id AS account_public_id,
                owner.public_id AS owner_public_id, ou.parent_id AS parent_org_unit_id
         FROM product_signal ps
         LEFT JOIN activity act ON act.id = ps.activity_id
         LEFT JOIN post_call pc ON pc.id = ps.post_call_id
         LEFT JOIN deal d ON d.id = ps.deal_id
         JOIN account acc ON acc.id = ps.account_id
         JOIN app_user owner ON owner.id = ps.owner_user_id
         LEFT JOIN org_unit ou ON ou.id = ps.org_unit_id
         WHERE d.public_id = $1 AND ps.signal_type = $2 AND ps.deleted_at IS NULL
         ORDER BY ps.created_at DESC
         LIMIT $3`,
        [dealId, signalType, limitCount],
      );
      return (res.rows as Row[]).map(productSignalDoc);
    });
  }
}

export function createPostgresReadRepository(
  pool: PgPool,
  session: SqlSession,
  env?: PostgresEnv,
): PostgresReadRepository {
  return new PostgresReadRepository(pool, session, env);
}

export function persistenceReadReady(env?: PersistenceReadEnv): boolean {
  const mode = (env?.PERSISTENCE_READ_MODE || process.env.PERSISTENCE_READ_MODE || "firestore").trim();
  return mode === "pg" && isNodeRuntime() && postgresReady(env);
}
