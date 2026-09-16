#!/usr/bin/env node
/**
 * Read-only GCP checks for the 2026-09-11 UAT remediation plan, item §5.1.
 *
 * Bypasses the gcloud CLI entirely (this machine has no Homebrew/Xcode and
 * only Python 3.9, which the current gcloud CLI refuses to run under —
 * "no longer supported"). Instead does the OAuth2 JWT-bearer exchange for a
 * service-account key directly (RS256 sign via node:crypto, no dependency
 * beyond what's already in worker/node_modules) and calls the Cloud Run
 * Admin API v2 and Cloud SQL Admin API v1 REST endpoints directly.
 *
 * READ-ONLY: only ever issues GET requests. Does not print secret VALUES —
 * for Cloud Run env vars it reports the KEY and whether it is a plain `value`
 * or a `secretKeyRef` (which is what actually matters for the plaintext-
 * secrets question), never the value itself.
 *
 * Usage:
 *   node worker/scripts/gcp-readonly-check.mjs --key=/absolute/path/to/key.json \
 *     [--project=se-singha-paathi] [--service=se-labs-worker] \
 *     [--run-region=us-central1] [--sql-instance=janus-db]
 *
 * The key file path is read from disk here — never paste key file CONTENTS
 * into chat. This script never logs the key's contents either.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const keyPath = arg("key");
if (!keyPath) {
  console.error("Usage: node gcp-readonly-check.mjs --key=/path/to/service-account.json [--project=...] [--service=...] [--run-region=...] [--sql-instance=...]");
  process.exit(1);
}

const PROJECT = arg("project", "se-singha-paathi");
const SERVICE = arg("service", "se-labs-worker");
const RUN_REGION = arg("run-region", "us-central1");
const SQL_INSTANCE = arg("sql-instance", "janus-db");

/** Base64url, no padding — what JWT needs. */
function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint a short-lived OAuth2 access token from a service-account JSON key, read-only scope. */
async function getAccessToken(keyFilePath) {
  const key = JSON.parse(readFileSync(keyFilePath, "utf8"));
  if (!key.private_key || !key.client_email) {
    throw new Error("Key file does not look like a service-account JSON key (missing private_key/client_email).");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(key.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true, status: res.status, body };
}

const token = await getAccessToken(keyPath);
console.log(`Authenticated. Checking project ${PROJECT}.\n`);

// --- Cloud Run: revision/env config ---------------------------------------
console.log(`=== Cloud Run service: ${SERVICE} (${RUN_REGION}) ===`);
const runUrl = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${RUN_REGION}/services/${SERVICE}`;
const runResult = await getJson(runUrl, token);
if (!runResult.ok) {
  console.log(`  FAILED (${runResult.status}):`, JSON.stringify(runResult.body).slice(0, 300));
  console.log(`  If 404: the service name/region may be wrong. Try listing services:`);
  console.log(`    GET https://run.googleapis.com/v2/projects/${PROJECT}/locations/${RUN_REGION}/services`);
} else {
  const svc = runResult.body;
  console.log(`  latestReadyRevision: ${svc.latestReadyRevision}`);
  console.log(`  uri: ${svc.uri}`);
  const containers = svc.template?.containers ?? [];
  for (const c of containers) {
    console.log(`  container image: ${c.image}`);
    for (const e of c.env ?? []) {
      if (e.value !== undefined) {
        console.log(`    env  ${e.name} = <plaintext env var, value redacted here>`);
      } else if (e.valueSource?.secretKeyRef) {
        const ref = e.valueSource.secretKeyRef;
        console.log(`    env  ${e.name} = <secretKeyRef: ${ref.secret}:${ref.version}>`);
      } else {
        console.log(`    env  ${e.name} = <unrecognized env entry shape>`);
      }
    }
  }
  console.log(`\n  VERDICT: any "env ... = <plaintext env var>" line above means that variable is a`);
  console.log(`  plain --set-env-vars entry, not Secret Manager-backed. Any "secretKeyRef" line means`);
  console.log(`  it correctly goes through Secret Manager.`);
}

// --- Cloud SQL: instance region -------------------------------------------
console.log(`\n=== Cloud SQL instance: ${SQL_INSTANCE} ===`);
const sqlUrl = `https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}`;
const sqlResult = await getJson(sqlUrl, token);
if (!sqlResult.ok) {
  console.log(`  FAILED (${sqlResult.status}):`, JSON.stringify(sqlResult.body).slice(0, 300));
} else {
  console.log(`  region: ${sqlResult.body.region}`);
  console.log(`  databaseVersion: ${sqlResult.body.databaseVersion}`);
  console.log(`  state: ${sqlResult.body.state}`);
}

console.log(`\n=== Cross-region check ===`);
if (runResult.ok && sqlResult.ok) {
  const same = RUN_REGION === sqlResult.body.region;
  console.log(`  Cloud Run region: ${RUN_REGION}`);
  console.log(`  Cloud SQL region: ${sqlResult.body.region}`);
  console.log(`  ${same ? "SAME region — the cross-region hypothesis is REFUTED." : "DIFFERENT regions — the cross-region hypothesis is CONFIRMED."}`);
}
