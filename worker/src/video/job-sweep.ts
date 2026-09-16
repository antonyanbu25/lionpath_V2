/**
 * Startup sweep for orphaned Pass 2 job directories (crashed mid-job).
 */

import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { videoDataRoot } from "./capability";
import { STAGING_TTL_MS } from "./retention";

export interface JobSweepResult {
  removed: number;
  scanned: number;
}

/** Remove job dirs under VIDEO_DATA_DIR older than maxAgeMs (default STAGING_TTL_MS). */
export async function sweepStaleVideoJobs(maxAgeMs = STAGING_TTL_MS): Promise<JobSweepResult> {
  const root = videoDataRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return { removed: 0, scanned: 0 };
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const dir = path.join(root, name);
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (st.mtimeMs >= cutoff) continue;
    try {
      await rm(dir, { recursive: true, force: true });
      removed++;
    } catch (err) {
      console.warn(
        "[video/job-sweep] failed to remove stale job dir:",
        dir,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { removed, scanned: entries.length };
}
