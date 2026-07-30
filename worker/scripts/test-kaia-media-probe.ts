/**
 * Unit test: Kaia media probe structure (mocked fetch — no live network required).
 * Run: tsx scripts/test-kaia-media-probe.ts
 */

import assert from "node:assert/strict";
import { probeKaiaMediaForRef } from "../src/kaia/media.ts";
import type { KaiaShareRef } from "../src/kaia/shareLink.ts";

const ref: KaiaShareRef = {
  password: "testpwd",
  instanceId: "020654b4-1c1d-439d-a30f-f851026343fe:secret",
  linkId: "6105",
  bento: "app1f",
};

async function testProbeReportsSummaryOnly() {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("sharable-links/6105?") && !/\/(media|recording|video|stream|download|mp4)/.test(url)) {
      return new Response(JSON.stringify({ data: { id: 1, meetingSummary: "hi" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await probeKaiaMediaForRef(ref, mockFetch);
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, "summary_api_only");
  assert.match(result.message, /summary text only/i);
  assert.ok((result.probed?.length || 0) >= 2);
}

await testProbeReportsSummaryOnly();
console.log("test-kaia-media-probe: ok");
