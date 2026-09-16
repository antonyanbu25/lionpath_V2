#!/usr/bin/env node
/**
 * Pack web/ for Cloud Run / static upload (portal.benjaminsquare.com).
 * Output: web/dist/se-prep-portal-web-static-v11.zip
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(WEB_ROOT, "dist");
const ZIP_PATH = join(OUT_DIR, "se-prep-portal-web-static-v11.zip");
const MARKER = "static-v11";

async function logDebug(data) {
  const line = `${JSON.stringify({
    sessionId: "161178",
    timestamp: Date.now(),
    hypothesisId: "P",
    location: "pack-web-cloudrun.mjs",
    message: "Cloud Run web pack",
    data,
    runId: MARKER,
  })}\n`;
  const logPath = "/Users/ssunil/Documents/init/Se Prep Portal/.cursor/debug-161178.log";
  try {
    await writeFile(logPath, line, { flag: "a" });
  } catch {
    // ignore
  }
}

await mkdir(OUT_DIR, { recursive: true });

const indexHtml = await readFile(join(WEB_ROOT, "index.html"), "utf8");
const hasFix =
  indexHtml.includes('data-dispute-ui-version="static-v11"') &&
  indexHtml.includes("se-build-badge") &&
  indexHtml.includes("prep-dispute-modal");

if (!hasFix) {
  console.error("FAIL: index.html missing static-v11 dispute UI — pack aborted.");
  process.exit(1);
}

await writeFile(
  join(OUT_DIR, "BUILD_MARKER.txt"),
  `dispute-ui=${MARKER}\npacked-at=${new Date().toISOString()}\n`,
  "utf8",
);

execSync(
  `cd "${WEB_ROOT}" && zip -r "${ZIP_PATH}" . -x "dist/*" -x "node_modules/*" -x "package-lock.json" -x ".DS_Store"`,
  { stdio: "inherit" },
);
execSync(`cd "${OUT_DIR}" && zip -u "${ZIP_PATH}" BUILD_MARKER.txt`, { stdio: "inherit" });

const stats = {
  zipPath: ZIP_PATH,
  disputeUiVersion: MARKER,
  prepDisputeInSource: (indexHtml.match(/prep-dispute/g) || []).length,
  hasBuildBadge: indexHtml.includes("se-build-badge"),
};

await logDebug(stats);
console.log("\nPacked Cloud Run web bundle:");
console.log(JSON.stringify(stats, null, 2));
console.log("\nUpload to Cloud Run, then verify:");
console.log("  curl -sL https://portal.benjaminsquare.com/ | grep -c static-v11");
