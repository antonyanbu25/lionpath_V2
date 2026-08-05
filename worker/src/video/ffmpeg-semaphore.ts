/**
 * In-process ffmpeg concurrency gate — Cloud Run may accept many HTTP requests
 * while each Pass 2 job spawns heavy ffmpeg child processes.
 */

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_QUEUE_WAIT_MS = 120_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.round(n);
}

/** Max simultaneous ffmpeg child processes in this Node process. */
export function ffmpegMaxConcurrent(): number {
  return parsePositiveInt(process.env.FFMPEG_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT);
}

/** Max wait for a queued ffmpeg slot before failing the job. */
export function ffmpegQueueWaitMs(): number {
  return parsePositiveInt(process.env.FFMPEG_QUEUE_WAIT_MS, DEFAULT_QUEUE_WAIT_MS);
}

type QueueEntry = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class FfmpegSemaphore {
  private active = 0;
  private readonly queue: QueueEntry[] = [];

  async acquire(): Promise<void> {
    const max = ffmpegMaxConcurrent();
    if (this.active < max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          clearTimeout(entry.timer);
          this.active++;
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new Error(`ffmpeg queue timeout after ${ffmpegQueueWaitMs()}ms (${max} slots busy)`));
        }, ffmpegQueueWaitMs()),
      };
      this.queue.push(entry);
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (!next) return;
    clearTimeout(next.timer);
    this.active++;
    next.resolve();
  }

  resetForTests(): void {
    for (const entry of this.queue) {
      clearTimeout(entry.timer);
      entry.reject(new Error("ffmpeg semaphore reset"));
    }
    this.queue.splice(0, this.queue.length);
    this.active = 0;
  }
}

const gate = new FfmpegSemaphore();

/** Run one ffmpeg invocation under the process-wide slot limit. */
export async function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  await gate.acquire();
  try {
    return await fn();
  } finally {
    gate.release();
  }
}

/** Test seam — reset slot counters between unit tests. */
export function resetFfmpegSemaphoreForTests(): void {
  gate.resetForTests();
}
