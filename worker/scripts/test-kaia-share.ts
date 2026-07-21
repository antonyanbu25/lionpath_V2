import assert from "node:assert/strict";
import {
  formatSummaryJson,
  isKaiaShareUrl,
  parseKaiaShareUrl,
} from "../src/kaiaShare.ts";

const EXAMPLE_URL =
  "https://engage.freshworks.com/kaia/share/JTdCJTIydiUyMiUzQSU3QiUyMnAlMjIlM0ElMjJNNFdvSFd6OCUyMiUyQyUyMm0lMjIlM0ElMjIwMjA2NTRiNC0xYzFkLTQzOWQtYTMwZi1mODUxMDI2MzQzZmUlM0F4cVM3ZF9BM1FxMnYyZ3VBeEVtWGVnJTIyJTJDJTIyaSUyMiUzQSUyMjU5ODIlMjIlN0QlN0Q=?";

assert.equal(isKaiaShareUrl(EXAMPLE_URL), true);
assert.equal(isKaiaShareUrl("https://zoom.us/rec/share/abc"), false);

const parsed = parseKaiaShareUrl(EXAMPLE_URL);
assert.equal(parsed.linkId, "5982");
assert.equal(parsed.orgPassword, "M4WoHWz8");
assert.equal(parsed.meetingId, "020654b4-1c1d-439d-a30f-f851026343fe:xqS7d_A3Qq2v2guAxEmXeg");
assert.equal(parsed.bento, "app1f");

const sampleJson = JSON.stringify([
  {
    type: "STRING",
    name: "Outcome",
    result: { stringOutput: "Discussed filters and plan limits." },
  },
  {
    type: "LIST_KEY_POINTS",
    name: "Key points",
    result: {
      listKeyPoints: [
        {
          title: "Portal filters",
          points: [
            {
              text: "Cannot find company filters",
              sources: [{ speaker: { name: "Fatema AlBasha" } }],
            },
          ],
        },
      ],
    },
  },
]);

const formatted = formatSummaryJson(sampleJson);
assert.match(formatted, /Outcome/);
assert.match(formatted, /Discussed filters and plan limits/);
assert.match(formatted, /Fatema AlBasha/);
assert.match(formatted, /Cannot find company filters/);

console.log("test-kaia-share: ok");
