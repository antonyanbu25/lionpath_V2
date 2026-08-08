/**
 * Unit tests for POST /api/disputes/notify — soft-fail when flag off; provider call when on.
 */
import assert from "node:assert/strict";
import { handleDisputeNotifyPost } from "../src/routes.ts";
import { emailNotifyAvailable, sendManagerDisputeEmail } from "../src/notify-email.ts";

function mockRequest(body: unknown): Request {
  return new Request("http://127.0.0.1:8787/api/disputes/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const cors = { "Access-Control-Allow-Origin": "*" };

// --- emailNotifyAvailable ---
assert.equal(emailNotifyAvailable({}), false);
assert.equal(emailNotifyAvailable({ DISPUTE_NOTIFY_ENABLED: "1" }), false);
assert.equal(
  emailNotifyAvailable({ DISPUTE_NOTIFY_ENABLED: "1", EMAIL_PROVIDER_API_KEY: "re_test" }),
  true,
);
assert.equal(
  emailNotifyAvailable({ DISPUTE_NOTIFY_ENABLED: "0", EMAIL_PROVIDER_API_KEY: "re_test" }),
  false,
);
console.log("ok: emailNotifyAvailable gating");

// --- route: flag off → { sent: false }, not an error ---
{
  const env = {
    ALLOWED_EMAIL_DOMAIN: "freshworks.com",
    DISPUTE_NOTIFY_ENABLED: "0",
    EMAIL_PROVIDER_API_KEY: "",
  } as Parameters<typeof handleDisputeNotifyPost>[1];

  const res = await handleDisputeNotifyPost(
    mockRequest({
      email: "se@freshworks.com",
      to: "manager@freshworks.com",
      toName: "Mgr",
      seName: "SE",
      callTitle: "Acme · storytelling",
      category: "Score too low",
      note: "Evidence missed context",
      via: "line_manager",
    }),
    env,
    new URL("http://127.0.0.1:8787/api/disputes/notify"),
    cors,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sent: boolean; via: string | null };
  assert.equal(body.sent, false);
  assert.ok(body.via === null || body.via === "line_manager");
  console.log("ok: /api/disputes/notify returns {sent:false} when flag off");
}

// --- sendManagerDisputeEmail: provider called when enabled ---
{
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let fetchUrl = "";
  let fetchInit: RequestInit | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    fetchUrl = String(input);
    fetchInit = init;
    return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendManagerDisputeEmail(
      {
        DISPUTE_NOTIFY_ENABLED: "1",
        EMAIL_PROVIDER_API_KEY: "re_test_key",
        DISPUTE_NOTIFY_FROM: "LionPath <noreply@example.com>",
      },
      {
        to: "manager@freshworks.com",
        toName: "Ajay",
        seName: "Saketh",
        callTitle: "Acme · storytelling",
        category: "Score too low",
        note: "Missed context",
        link: "http://localhost:8788/",
      },
    );
    assert.equal(result.sent, true);
    assert.equal(result.via, "resend");
    assert.equal(fetchCalls, 1);
    assert.ok(fetchUrl.includes("api.resend.com"));
    const headers = fetchInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_test_key");
    const payload = JSON.parse(String(fetchInit?.body || "{}"));
    assert.equal(payload.to[0], "manager@freshworks.com");
    assert.match(payload.subject, /Saketh/);
    console.log("ok: provider fetch called when notify enabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- route: flag on + mock fetch ---
{
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ id: "email_route" }), { status: 200 });
  }) as typeof fetch;

  try {
    const env = {
      ALLOWED_EMAIL_DOMAIN: "freshworks.com",
      DISPUTE_NOTIFY_ENABLED: "1",
      EMAIL_PROVIDER_API_KEY: "re_route_key",
      DISPUTE_NOTIFY_FROM: "LionPath <noreply@example.com>",
    } as Parameters<typeof handleDisputeNotifyPost>[1];

    const res = await handleDisputeNotifyPost(
      mockRequest({
        email: "se@freshworks.com",
        to: "manager@freshworks.com",
        seName: "SE",
        callTitle: "Call",
        category: "other",
        note: "n",
      }),
      env,
      new URL("http://127.0.0.1:8787/api/disputes/notify"),
      cors,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { sent: boolean; via: string | null };
    assert.equal(body.sent, true);
    assert.equal(body.via, "resend");
    assert.equal(called, true);
    console.log("ok: /api/disputes/notify sends when flag on");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("\nAll dispute-notify checks passed.");
