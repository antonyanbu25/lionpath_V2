/** Snapshot/DOM assertions for QIP category radar (SE labs evaluation pentagon). */
import assert from "node:assert/strict";
import { renderQipRadar } from "../qip-radar.js";
import { CATEGORY_KEYS, QIP_RADAR_LABELS } from "../rubric-profiles.js";

const AXIS_COLORS = ["#161513", "#3f3d38", "#6b675e", "#8b867c", "#a39e93"];

const sampleScores = {
  discovery_qualification: 8.2,
  solution_technical_fit: 7.1,
  business_value: 6.4,
  credibility_objections: null,
  communication_control: 7.8,
};

const html = renderQipRadar(sampleScores, {
  overallScore: 7.3,
  title: "Evaluation signal",
  animate: false,
});

assert.equal(typeof renderQipRadar, "function", "exports renderQipRadar");
assert.ok(html.includes("qip-radar-svg"), "renders radar svg");
assert.ok(html.includes('viewBox="0 0 600 500"'), "labs 600x500 viewBox");
assert.ok(html.includes("star-overall-pill"), "overall score in header pill");
assert.ok(html.includes(">7.3<"), "pill shows composite score 7.3");
assert.ok(html.includes("overall"), "pill has overall label");
assert.ok(!html.includes("qip-star-core"), "no center score core");
assert.ok(!html.includes("qip-radar-core-disk"), "no white center disk");

const dots = [...html.matchAll(/class="[^"]*\bqip-radar-dot\b[^"]*"/g)];
assert.equal(dots.length, 5, "five vertex dots");

for (let i = 0; i < AXIS_COLORS.length; i++) {
  const color = AXIS_COLORS[i];
  assert.ok(
    html.includes(`data-axis-color="${color}"`),
    `vertex ${i} tagged with axis color ${color}`,
  );
  assert.ok(html.includes(`fill="${color}"`), `vertex uses axis fill ${color}`);
}

assert.ok(html.includes("qip-radar-data"), "data polygon present");
const dataMatch = html.match(/class="qip-radar-data" points="([^"]+)"/);
assert.ok(dataMatch, "data polygon has points");
assert.equal(dataMatch[1].trim().split(/\s+/).length, 5, "5-vertex data pentagon");

assert.ok(html.includes("qip-radar-wash"), "multi-hue wash fills");
assert.ok(html.includes("clip-path="), "wash clipped to score polygon");
assert.ok(html.includes("-stroke"), "rainbow stroke gradient");
assert.ok(html.includes('stroke-width="2.5"'), "labs stroke weight");
assert.ok(!html.includes("qip-radar-edge"), "no per-edge stroke lines");
assert.ok(!html.includes("feGaussianBlur"), "no bloom filters");
assert.ok(!html.includes("stroke-dasharray"), "solid outer ring");

const scaleNums = [...html.matchAll(/class="lab qip-radar-scale"[^>]*>(\d+)</g)].map((m) => m[1]);
assert.deepEqual(scaleNums, ["2", "4", "6", "8", "10"], "scale numerals are 2–10");

for (const key of CATEGORY_KEYS) {
  const line = String(QIP_RADAR_LABELS[key] || "").split("\n")[0];
  assert.ok(html.includes(line), `label present for ${key}`);
}

assert.ok(html.includes('font-size="18"'), "category scores ~18px mono");
assert.ok(html.includes("EVALUATION SIGNAL") || html.includes("Evaluation signal"), "header title present");
assert.ok(html.includes("Five categories, each scored out of 10"), "labs caption");
assert.ok(html.includes('class="eyebrow"') || html.includes("star-title"), "header title styled");

/** Null category score → axis at 0, no crash */
const nullHtml = renderQipRadar(
  {
    discovery_qualification: null,
    solution_technical_fit: undefined,
    business_value: NaN,
    credibility_objections: null,
    communication_control: null,
  },
  { overallScore: 0, animate: false },
);
assert.ok(nullHtml.includes("qip-radar-svg"), "null scores still render");
assert.equal((nullHtml.match(/class="[^"]*\bqip-radar-dot\b[^"]*"/g) || []).length, 5, "five dots with null scores");
assert.ok(nullHtml.includes("qip-radar-data"), "data polygon with zeroed axes");
assert.ok(nullHtml.includes(">0.0<"), "zero overall still shown in pill");

console.log("test-qip-radar: ok");
