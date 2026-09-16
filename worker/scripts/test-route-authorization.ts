#!/usr/bin/env tsx
/**
 * Route authorization regression gate (astra-audit P4 — F-004, F-010, F-011,
 * plus the merge report's /api/read-models/schedule gap).
 *
 * Three holes were confirmed still open on this branch before these fixes:
 *   F-004  POST /api/calls/:id/offload-payload authenticated, then discarded the
 *          context and never loaded the call — any signed-in user could
 *          overwrite ANY call's offloaded payload.
 *   F-010  GET /api/feedback?global=1 returned before the only auth call, so an
 *          unauthenticated caller received every user's feedback, with emails.
 *   F-011  POST /api/search/rag had no auth call at all and spent embedding
 *          budget on the server's own credentials.
 *
 * Covers what is provable in-process. The two Firestore-backed handlers
 * (offload-payload, read-models/schedule) cannot be driven here without the
 * emulator — no JDK is available on this machine — so their authorization
 * DECISION is tested through the predicate they now call, and their wiring is
 * covered by the typechecker. That split is deliberate and stated rather than
 * papered over with a mock that would prove nothing.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stampVerifiedUsageIdentity } from "../src/data/llm-usage.ts";
import {
  canReadResource,
  canWriteResource,
  assertCanWriteResource,
  type RequestContext,
} from "../src/data/scope.ts";
import { handleFeedbackGet, handleSearchRag } from "../src/routes.ts";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Scope predicates — read is intentionally WIDER than write.
// ---------------------------------------------------------------------------
const ctx = (over: Partial<RequestContext>): RequestContext => ({
  authUid: "uid",
  email: "u@freshworks.com",
  userId: "usr_other",
  role: "se",
  teamId: null,
  orgId: null,
  isOrgLeader: false,
  ...over,
});

// The resource under test: owned by usr_owner, in team_1 of org_1.
const RESOURCE = { ownerId: "usr_owner", teamId: "team_1", orgId: "org_1" };

const OWNER = ctx({ userId: "usr_owner", teamId: "team_1", orgId: "org_1" });
const ADMIN = ctx({ userId: "usr_admin", role: "admin", teamId: "team_9", orgId: "org_9" });
const MGR_SAME_TEAM = ctx({ userId: "usr_mgr", role: "manager", teamId: "team_1", orgId: "org_1" });
const MGR_OTHER_TEAM = ctx({ userId: "usr_mgr2", role: "manager", teamId: "team_2", orgId: "org_1" });
const ORG_LEADER = ctx({ userId: "usr_dir", role: "manager", teamId: "team_7", orgId: "org_1", isOrgLeader: true });
// Two users in DIFFERENT org subtrees — the case P4 calls out explicitly.
const OTHER_ORG_SE = ctx({ userId: "usr_far", teamId: "team_5", orgId: "org_2" });
const OTHER_ORG_MGR = ctx({ userId: "usr_farmgr", role: "manager", teamId: "team_5", orgId: "org_2", isOrgLeader: true });

console.log("\n1. read scope (positive and negative)");
check("owner can read own", () => assert.equal(canReadResource(OWNER, RESOURCE), true));
check("admin can read", () => assert.equal(canReadResource(ADMIN, RESOURCE), true));
check("manager in same team can read", () => assert.equal(canReadResource(MGR_SAME_TEAM, RESOURCE), true));
check("org leader of same org can read", () => assert.equal(canReadResource(ORG_LEADER, RESOURCE), true));
check("manager in a different team cannot read", () => assert.equal(canReadResource(MGR_OTHER_TEAM, RESOURCE), false));
check("SE in a different org subtree cannot read", () => assert.equal(canReadResource(OTHER_ORG_SE, RESOURCE), false));
check("org leader of a DIFFERENT org cannot read", () => assert.equal(canReadResource(OTHER_ORG_MGR, RESOURCE), false));

console.log("\n2. write scope is narrower than read — this is the F-004 decision");
check("owner can write own", () => assert.equal(canWriteResource(OWNER, RESOURCE), true));
check("admin can write", () => assert.equal(canWriteResource(ADMIN, RESOURCE), true));
check(
  "manager in same team CAN read but CANNOT write (mirrors post_call_owner_write RLS)",
  () => {
    assert.equal(canReadResource(MGR_SAME_TEAM, RESOURCE), true);
    assert.equal(canWriteResource(MGR_SAME_TEAM, RESOURCE), false);
  },
);
check("org leader CAN read but CANNOT write", () => {
  assert.equal(canReadResource(ORG_LEADER, RESOURCE), true);
  assert.equal(canWriteResource(ORG_LEADER, RESOURCE), false);
});
check("SE in a different org subtree cannot write", () => assert.equal(canWriteResource(OTHER_ORG_SE, RESOURCE), false));
check("a resource with no ownerId is not writable by a non-admin", () =>
  assert.equal(canWriteResource(OWNER, { teamId: "team_1", orgId: "org_1" }), false));

console.log("\n3. an unauthorised write must not leak that the resource exists");
check("assertCanWriteResource throws 404, not 403", () => {
  try {
    assertCanWriteResource(OTHER_ORG_SE, RESOURCE);
    throw new Error("expected a throw");
  } catch (err) {
    const status = (err as { status?: number }).status;
    assert.equal(status, 404, `expected status 404 (no existence oracle), got ${status}`);
  }
});
check("assertCanWriteResource passes for the owner", () => assertCanWriteResource(OWNER, RESOURCE));

// ---------------------------------------------------------------------------
// 4. Route-level: unauthenticated callers are refused.
// ---------------------------------------------------------------------------
const cors = { "Access-Control-Allow-Origin": "*" };

/** Feedback storage must resolve, or the handler 503s before reaching auth. */
const withBackend = (extra: Record<string, unknown> = {}) =>
  ({
    HISTORY_BACKEND: {
      get: async () => null,
      put: async () => undefined,
    },
    ...extra,
  }) as unknown as Parameters<typeof handleFeedbackGet>[1];

async function statusOf(run: () => Promise<Response>): Promise<number> {
  try {
    return (await run()).status;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") return status; // requireUser throws 401 when a token is absent
    throw err;
  }
}

console.log("\n4. GET /api/feedback?global=1 — the F-010 bypass");
{
  const url = new URL("http://127.0.0.1:8787/api/feedback?global=1");
  const req = new Request(url.toString());

  // Dummy-auth mode: requireUser returns null, so the handler must refuse.
  const dummyStatus = await statusOf(() => handleFeedbackGet(req, withBackend(), url, cors));
  check("unauthenticated (dummy mode) is refused, not served", () =>
    assert.equal(dummyStatus, 401, `expected 401, got ${dummyStatus}`));

  // Enforced mode with no bearer token: requireUser throws 401.
  const enforcedStatus = await statusOf(() =>
    handleFeedbackGet(req, withBackend({ FIREBASE_PROJECT_ID: "p" }), url, cors),
  );
  check("unauthenticated (enforced mode) is refused", () =>
    assert.equal(enforcedStatus, 401, `expected 401, got ${enforcedStatus}`));

  // The non-global path must keep working the way it did.
  const plainUrl = new URL("http://127.0.0.1:8787/api/feedback?email=se@freshworks.com");
  const plainStatus = await statusOf(() =>
    handleFeedbackGet(new Request(plainUrl.toString()), withBackend({ ALLOWED_EMAIL_DOMAIN: "freshworks.com" }), plainUrl, cors),
  );
  check("non-global feedback read still resolves (not broken by the fix)", () =>
    assert.ok(plainStatus === 200 || plainStatus === 401, `unexpected ${plainStatus}`));
}

console.log("\n5. POST /api/search/rag — the F-011 unauthenticated compute spend");
{
  const url = new URL("http://127.0.0.1:8787/api/search/rag");
  const body = JSON.stringify({ query: "pricing objection", candidates: [] });
  const mk = () => new Request(url.toString(), { method: "POST", headers: { "content-type": "application/json" }, body });

  const dummyStatus = await statusOf(() =>
    handleSearchRag(mk(), {} as Parameters<typeof handleSearchRag>[1], url, cors),
  );
  check("unauthenticated (dummy mode) is refused before any embedding call", () =>
    assert.equal(dummyStatus, 401, `expected 401, got ${dummyStatus}`));

  const enforcedStatus = await statusOf(() =>
    handleSearchRag(mk(), { FIREBASE_PROJECT_ID: "p" } as Parameters<typeof handleSearchRag>[1], url, cors),
  );
  check("unauthenticated (enforced mode) is refused", () =>
    assert.equal(enforcedStatus, 401, `expected 401, got ${enforcedStatus}`));
}

console.log("\n6. Usage attribution must come from the session, not the request body (P9/J-019)");
{
  // handleAnalyzeCall used to call requireUser and throw the result away, then
  // pass the parsed body to the pipeline with its client-supplied userId
  // intact. That is an attribution-spoofing hole as well as the main reason
  // ai_run.user_id sat at 16.5%: a caller could bill its token spend to
  // another user, and omitting the field simply produced NULL.
  const spoofed = { userId: "uid_someone_else", transcript: "t" };
  stampVerifiedUsageIdentity(spoofed, { uid: "uid_verified_caller" });
  check("a client-supplied userId is overridden by the verified session", () =>
    assert.equal(spoofed.userId, "uid_verified_caller"));

  const absent: { userId?: string } = {};
  stampVerifiedUsageIdentity(absent, { uid: "uid_verified_caller" });
  check("an absent userId is populated from the verified session", () =>
    assert.equal(absent.userId, "uid_verified_caller"));

  // requireUser returns null in dummy-auth mode by design. There is no
  // verified identity to prefer, so the client value must survive rather than
  // be blanked — blanking it would REDUCE local-dev attribution to zero.
  const dummy = { userId: "uid_dev_user" };
  stampVerifiedUsageIdentity(dummy, null);
  check("dummy-auth mode keeps the client value (nothing better exists)", () =>
    assert.equal(dummy.userId, "uid_dev_user"));

  const blank = { userId: "uid_dev_user" };
  stampVerifiedUsageIdentity(blank, { uid: "   " });
  check("a blank verified uid does not erase a usable client value", () =>
    assert.equal(blank.userId, "uid_dev_user"));

  // The guard that keeps this wired: the handler must bind requireUser's
  // result and stamp it. Asserted on source because driving handleAnalyzeCall
  // end to end needs a live Gemini key and a real transcript.
  const routes = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
  const handler = routes.slice(routes.indexOf("export async function handleAnalyzeCall"));
  const body = handler.slice(0, handler.indexOf("\nexport "));
  check("handleAnalyzeCall binds requireUser's result rather than discarding it", () =>
    assert.match(body, /const verified = await requireUser\(/));
  check("handleAnalyzeCall stamps the verified identity onto the pipeline input", () =>
    assert.match(body, /stampVerifiedUsageIdentity\(input, verified\)/));
}

console.log("\n7. POST /api/fetch-transcript must not fetch arbitrary URLs (08 §7 SSRF)");
{
  // `08` §7 and P-D2 item 1 rank this the top security gap: "an authenticated
  // user supplies an arbitrary URL the server fetches — SSRF, and on Cloud Run
  // that reaches the metadata server unless egress is restricted".
  //
  // Measured: FALSE. parseShareUrl rejects every one of these before any
  // network call. The finding was reasoned from the handler, which does pass
  // body.recordingUrl straight through, without checking what the callee does
  // with it.
  //
  // Kept as a gate rather than just a correction, because the protection is
  // load-bearing and NOT obvious from the handler: it lives in SHARE_URL_RE,
  // which requires the host to be zoom.us/zoomgov.com AND be followed
  // immediately by /rec/ or /recording/. That `/rec/` anchor is what defeats
  // the suffix attack below — a host allowlist alone would not. Loosen the
  // regex and this route becomes the SSRF the audit thought it already was.
  const { fetchRecordingFromShareLink } = await import("../src/zoomShare.ts");
  const attempts: string[] = [];
  const spy = (async (input: RequestInfo | URL) => {
    attempts.push(typeof input === "string" ? input : String((input as Request)?.url ?? input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const SSRF_PAYLOADS: Array<[string, string]> = [
    ["GCP metadata server (credential theft)", "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"],
    ["loopback PostgreSQL", "http://127.0.0.1:5432/"],
    ["the worker's own internal API", "http://localhost:8787/api/internal/outbox/project"],
    ["arbitrary external host", "https://evil.example.com/steal"],
    ["file scheme", "file:///etc/passwd"],
    // Defeated by the /rec/ anchor, not by the host pattern: the host here
    // genuinely CONTAINS zoom.us.
    ["zoom.us as a domain prefix", "https://freshworks.zoom.us.evil.example.com/rec/share/abc"],
    ["credentials-in-userinfo trick", "https://freshworks.zoom.us@evil.example.com/rec/share/abc"],
  ];

  for (const [label, payload] of SSRF_PAYLOADS) {
    attempts.length = 0;
    let threw = false;
    try {
      await fetchRecordingFromShareLink(payload, undefined, spy);
    } catch {
      threw = true;
    }
    check(`${label}: rejected with NO outbound request`, () => {
      assert.equal(attempts.length, 0, `attempted ${attempts.length} fetch(es): ${attempts.join(", ")}`);
      assert.ok(threw, "did not reject — it returned a result for a non-Zoom URL");
    });
  }
}

console.log("\n8. No SELECT may mix set_config with anything else (J-010 class guard)");
{
  // J-010 was: one statement listing a predicate BEFORE its setter —
  //
  //   SELECT account_writable_by_current_user(...) AS ok,
  //          set_config('app.user_id', $2, true) IS NOT NULL AS ctx_ok
  //
  // A target list is not evaluated top-to-bottom, and set_config with
  // is_local => true is scoped to the transaction (here an implicit
  // single-statement one), so the predicate ran with no session. Measured
  // against a CLAIMED account with the legitimate owner's session: true in
  // 0/10 attempts, versus true with the setter in an earlier statement.
  //
  // It recurred. The first occurrence was fixed in the account-write path;
  // an IDENTICAL copy survived in handleDealsCreate and was found later, by
  // reading the handler for an unrelated reason. Instance-by-instance fixes
  // clearly do not hold for this pattern, so guard the CLASS: set_config may
  // only ever appear in a SELECT whose target list contains nothing else.
  //
  // Why it hides: account_writable_by_current_user FAILS OPEN on an unclaimed
  // account (admin OR on-the-team OR unclaimed), and the unclaimed branch
  // needs no session — so the broken form returns true in exactly the case a
  // casual test would construct.
  const SRC_DIR = new URL("../src/", import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
      else if (entry.name.endsWith(".ts")) files.push(fileURLToPath(new URL(entry.name, dir)));
    }
  };
  walk(SRC_DIR);

  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Strip comments first: this file documents the bad pattern on purpose,
    // and so does routes.ts now. A guard that trips on its own explanation
    // would be deleted by the next person rather than fixed.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    // Scan SQL STRING LITERALS, not raw source. Scanning raw source needs a
    // terminator for the statement, and picking one is where this went wrong
    // first time: `(?=\`|;)` ran straight past the end of a double-quoted
    // query in history-pg.ts and swallowed the JS argument list, reporting a
    // false positive on correct code. Extract the literal, then reason inside it.
    const literals = [
      ...code.matchAll(/`([^`]*)`/g),
      ...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
      ...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
    ].map((m) => m[1]);

    for (const sql of literals) {
      if (!/\bset_config\s*\(/.test(sql)) continue;
      const sel = /SELECT\b([\s\S]*)$/i.exec(sql);
      if (!sel) {
        // set_config outside a SELECT (e.g. a SET statement) — not this hazard.
        continue;
      }
      // Allowed: a target list made only of set_config(...) calls, comma
      // separated. Anything else sharing the list is the J-010 shape.
      const stripped = sel[1].replace(/set_config\s*\([^)]*\)/g, "").replace(/[\s,]/g, "");
      if (stripped !== "") {
        offenders.push(
          `${file.split("/worker/")[1] ?? file}: SELECT mixes set_config with "${stripped.slice(0, 60)}"`,
        );
      }
    }
  }

  check("set_config is never mixed into a SELECT with other expressions", () =>
    assert.deepEqual(
      offenders,
      [],
      `a session variable set in the SAME target list as the expression that reads it ` +
        `is not visible to it — put the set_config in an EARLIER statement inside a ` +
        `transaction, or use withSessionContext/accountWritableBySession:\n  ` +
        offenders.join("\n  "),
    ));

  // Anti-tautology: the scan must actually be looking at something.
  check("the guard scanned a meaningful number of source files", () =>
    assert.ok(files.length > 50, `only scanned ${files.length} file(s) — the walk is broken`));
  const canonical = files.filter((f) => f.endsWith("session-context.ts"));
  check("the guard sees session-context.ts (which legitimately batches set_config)", () =>
    assert.equal(canonical.length, 1, `found ${canonical.length}`));
}

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} authorization check(s) failed.`);
  process.exit(1);
}
console.log("OK — route authorization gate passed.");
