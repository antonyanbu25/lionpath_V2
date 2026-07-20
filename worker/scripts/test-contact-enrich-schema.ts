import assert from "node:assert/strict";
import { ENRICH_SCHEMA } from "../src/contact/enrich.ts";

const disc = ENRICH_SCHEMA.properties.disc as { properties: Record<string, unknown> };
const conf = disc.properties.confidence as { enum: string[] };
assert.ok(conf.enum.includes("low"));
assert.ok(conf.enum.includes("medium"));
assert.equal(conf.enum.includes("high"), false);

console.log("test-contact-enrich-schema: ok");
