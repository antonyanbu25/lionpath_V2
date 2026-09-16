import assert from "node:assert/strict";
import { ENRICH_SCHEMA } from "../src/contact/enrich.ts";

const disc = ENRICH_SCHEMA.properties.disc as {
  required?: string[];
  properties: Record<string, { maxItems?: number; minItems?: number; enum?: string[] }>;
};
const conf = disc.properties.confidence as { enum: string[] };
assert.ok(conf.enum.includes("low"));
assert.ok(conf.enum.includes("medium"));
assert.equal(conf.enum.includes("high"), false);
assert.ok(disc.required?.includes("dos"));
assert.ok(disc.required?.includes("donts"));
assert.equal(disc.properties.dos.minItems, 3);
assert.equal(disc.properties.dos.maxItems, 3);
assert.equal(disc.properties.donts.minItems, 3);
assert.equal(disc.properties.donts.maxItems, 3);

console.log("test-contact-enrich-schema: ok");
