#!/usr/bin/env -S npx tsx
/**
 * Print QIP anchor coverage per profile — count and weight-weighted percentage.
 *
 * Usage:
 *   npx tsx worker/scripts/rubric-anchor-coverage.mjs
 */

import {
  computeAnchorCoverageReport,
  formatAnchorCoverageReport,
} from "../src/rubric-anchors.ts";

const report = computeAnchorCoverageReport();
console.log(formatAnchorCoverageReport(report));
