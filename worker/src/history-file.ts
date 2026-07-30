/**
 * File-based history backend for VPS / Node deployments (no Cloudflare KV).
 * One JSON file per email under HISTORY_FILE_DIR (mode 600, dir mode 700).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryBackend } from "./history";

function safeKeyFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
}

export function createFileHistoryBackend(dir: string): HistoryBackend {
  const root = path.resolve(dir);

  async function filePath(key: string): Promise<string> {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return path.join(root, safeKeyFilename(key));
  }

  return {
    async get(key: string): Promise<string | null> {
      try {
        return await fs.readFile(await filePath(key), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async put(key: string, value: string): Promise<void> {
      const fp = await filePath(key);
      const tmp = `${fp}.${process.pid}.tmp`;
      await fs.writeFile(tmp, value, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, fp);
      try {
        await fs.chmod(fp, 0o600);
      } catch {
        /* best-effort on platforms that ignore chmod */
      }
    },
  };
}
