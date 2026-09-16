#!/usr/bin/env -S npx tsx
/** Classify schema is scoped to the confirmed SE motion. */

import { classifySchema } from "../src/postcall/classify.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const nb = classifySchema("new_business");
const exp = classifySchema("expansion");
const nbEnum = nb.properties.primary.enum as string[];
const expEnum = exp.properties.primary.enum as string[];

assert(nbEnum.length === 8, "NB classify enum has 8 types");
assert(expEnum.length === 11, "expansion classify enum has 11 types");
assert(nbEnum.includes("demo"), "NB includes demo");
assert(!nbEnum.includes("demo_plan_upgrade"), "NB rejects plan-upgrade");
assert(!nbEnum.includes("demo_cross_sell"), "NB rejects cross-sell");
assert(!nbEnum.includes("ai_vision_demo"), "NB rejects AI vision");
assert(!nbEnum.includes("churn_mitigation"), "NB rejects churn");

assert(expEnum.includes("demo_plan_upgrade"), "expansion includes plan-upgrade");
assert(expEnum.includes("demo_cross_sell"), "expansion includes cross-sell");
assert(expEnum.includes("ai_vision_demo"), "expansion includes AI vision");
assert(expEnum.includes("churn_mitigation"), "expansion includes churn");
assert(!expEnum.includes("demo"), "expansion rejects generic demo");

const mixNb = (nb.properties.mix as { items: { properties: { type: { enum: string[] } } } }).items.properties.type.enum;
assert(mixNb.every((t) => nbEnum.includes(t)), "NB mix enum matches primary");

console.log("test-classify-motion: OK");
