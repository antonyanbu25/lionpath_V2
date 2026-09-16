import assert from "node:assert/strict";
import { runResilientResearchQueries } from "../src/prep/research.ts";
import type { LlmProvider, LlmRequest } from "../src/providers/types.ts";

const ctx = { companyName: "7wings", companyDomain: "7wings.com" };
const label = (_q: string, i: number) => `test/research query ${i + 1}`;

function mockProvider(
  handler: (req: LlmRequest) => Promise<{ text: string }>,
): LlmProvider {
  return { generate: handler };
}

{
  let calls = 0;
  const provider = mockProvider(async (req) => {
    calls++;
    const query = req.user.match(/Research query: (.+)\n/)?.[1] ?? "";
    if (query.includes("linkedin")) {
      throw new Error("Gemini produced no text (finishReason: MALFORMED_FUNCTION_CALL)");
    }
    return { text: `Summary for ${query}` };
  });

  const snippets = await runResilientResearchQueries(
    provider,
    [
      'site:7wings.com (about OR company)',
      '"shymaa" "7wings" site:linkedin.com/in',
      'site:7wings.com (support OR help)',
    ],
    ctx,
    label,
  );

  assert.equal(calls, 3);
  assert.equal(snippets.length, 2);
  assert.ok(snippets.every((s) => s.snippet.length > 0));
  console.log("ok: partial query failure returns remaining snippets");
}

{
  let calls = 0;
  const provider = mockProvider(async () => {
    calls++;
    throw new Error("Gemini produced no text (finishReason: MALFORMED_FUNCTION_CALL)");
  });

  const snippets = await runResilientResearchQueries(
    provider,
    ["q1", "q2"],
    ctx,
    label,
  );

  assert.equal(calls, 2);
  assert.equal(snippets.length, 0);
  console.log("ok: all query failures return empty snippets (caller may throw)");
}

console.log("research-resilience checks passed.");
