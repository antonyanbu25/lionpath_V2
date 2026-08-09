/**
 * Unit tests for worker/src/rate-limit.ts (the per-request rate limiter,
 * P2-2) — landed on the 2.1 line with zero test coverage. Pure in-memory
 * logic, no network/emulator/live API needed.
 */
import assert from "node:assert/strict";
import {
  checkRateLimit,
  isRateLimitExempt,
  extractUidForRateLimit,
  clientIpFromRequest,
  _resetRateLimits,
} from "../src/rate-limit.ts";

function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

// --- checkRateLimit: under limit ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_PER_MINUTE: "5", RATE_LIMIT_BURST: "5" };
  for (let i = 0; i < 5; i++) {
    const result = checkRateLimit("usr_a", undefined, env);
    assert.equal(result, null, `request ${i + 1}/5 should be allowed`);
  }
  console.log("PASS: allows up to the configured limit");
}

// --- checkRateLimit: over limit ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_PER_MINUTE: "3", RATE_LIMIT_BURST: "3" };
  for (let i = 0; i < 3; i++) checkRateLimit("usr_b", undefined, env);
  const blocked = checkRateLimit("usr_b", undefined, env);
  assert.ok(blocked, "4th request within the window should be blocked");
  assert.ok(blocked!.retryAfter > 0, "retryAfter should be positive");
  assert.equal(blocked!.limit, 3);
  console.log("PASS: blocks once the limit is exceeded, with a retryAfter hint");
}

// --- checkRateLimit: burst allowance takes precedence over the lower of the two ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_PER_MINUTE: "2", RATE_LIMIT_BURST: "10" };
  for (let i = 0; i < 10; i++) {
    const result = checkRateLimit("usr_c", undefined, env);
    assert.equal(result, null, `request ${i + 1}/10 should be allowed under burst`);
  }
  const blocked = checkRateLimit("usr_c", undefined, env);
  assert.ok(blocked, "11th request should exceed the burst ceiling");
  console.log("PASS: effective limit is max(perMinute, burst), not the lower one");
}

// --- checkRateLimit: per-key isolation (different users don't share a bucket) ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_PER_MINUTE: "1", RATE_LIMIT_BURST: "1" };
  const a1 = checkRateLimit("usr_d", undefined, env);
  const b1 = checkRateLimit("usr_e", undefined, env);
  assert.equal(a1, null);
  assert.equal(b1, null, "a different userId must not share usr_d's bucket");
  console.log("PASS: per-user buckets are isolated");
}

// --- checkRateLimit: falls back to IP-keyed bucket when userId is null (dummy auth mode) ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_PER_MINUTE: "1", RATE_LIMIT_BURST: "1" };
  const first = checkRateLimit(null, "203.0.113.5", env);
  const second = checkRateLimit(null, "203.0.113.5", env);
  assert.equal(first, null);
  assert.ok(second, "same IP with no userId should share one bucket and get blocked");
  console.log("PASS: falls back to IP-keyed bucket when userId is null");
}

// --- checkRateLimit: disabled via env ---
_resetRateLimits();
{
  const env = { RATE_LIMIT_ENABLED: "false", RATE_LIMIT_PER_MINUTE: "1", RATE_LIMIT_BURST: "1" };
  for (let i = 0; i < 20; i++) {
    assert.equal(checkRateLimit("usr_f", undefined, env), null, "disabled limiter must never block");
  }
  console.log("PASS: RATE_LIMIT_ENABLED=false disables the limiter entirely");
}

// --- isRateLimitExempt ---
{
  assert.ok(isRateLimitExempt("/api/health"));
  assert.ok(isRateLimitExempt("/api/health/live"));
  assert.ok(isRateLimitExempt("/api/config"));
  assert.ok(isRateLimitExempt("/api/zoom/status"));
  assert.ok(isRateLimitExempt("/api/health/anything"), "prefix match on /api/health");
  assert.ok(!isRateLimitExempt("/api/prep/research"), "non-exempt routes must not be exempt");
  console.log("PASS: exempt-path allowlist matches expected routes only");
}

// --- extractUidForRateLimit ---
{
  const validToken = fakeJwt({ sub: "usr_g", exp: Math.floor(Date.now() / 1000) + 3600 });
  const req1 = new Request("http://x", { headers: { Authorization: `Bearer ${validToken}` } });
  assert.equal(extractUidForRateLimit(req1), "usr_g");

  const expiredToken = fakeJwt({ sub: "usr_h", exp: Math.floor(Date.now() / 1000) - 10 });
  const req2 = new Request("http://x", { headers: { Authorization: `Bearer ${expiredToken}` } });
  assert.equal(extractUidForRateLimit(req2), null, "expired token must not yield a uid");

  const req3 = new Request("http://x", { headers: { Authorization: "Bearer not-a-jwt" } });
  assert.equal(extractUidForRateLimit(req3), null, "malformed token must not throw, just return null");

  const req4 = new Request("http://x");
  assert.equal(extractUidForRateLimit(req4), null, "missing Authorization header returns null");
  console.log("PASS: extractUidForRateLimit handles valid/expired/malformed/missing tokens");
}

// --- clientIpFromRequest header precedence ---
{
  const req1 = new Request("http://x", {
    headers: { "CF-Connecting-IP": "1.1.1.1", "X-Forwarded-For": "2.2.2.2", "X-Real-IP": "3.3.3.3" },
  });
  assert.equal(clientIpFromRequest(req1), "1.1.1.1", "CF-Connecting-IP wins first");

  const req2 = new Request("http://x", { headers: { "X-Forwarded-For": "2.2.2.2, 9.9.9.9" } });
  assert.equal(clientIpFromRequest(req2), "2.2.2.2", "X-Forwarded-For: first hop, trimmed");

  const req3 = new Request("http://x", { headers: { "X-Real-IP": "3.3.3.3" } });
  assert.equal(clientIpFromRequest(req3), "3.3.3.3");

  const req4 = new Request("http://x");
  assert.equal(clientIpFromRequest(req4), undefined, "no IP headers present");
  console.log("PASS: clientIpFromRequest respects CF-Connecting-IP > X-Forwarded-For > X-Real-IP");
}

console.log("\nAll rate-limit tests passed.");
