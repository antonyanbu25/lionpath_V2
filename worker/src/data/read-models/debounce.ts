const DEBOUNCE_MS = 60_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();

/**
 * Collapse burst writes on the same read-model key into one rebuild (60s window).
 */
export function scheduleDebounced(key: string, run: () => Promise<void>): void {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      if (inFlight.has(key)) {
        scheduleDebounced(key, run);
        return;
      }
      inFlight.add(key);
      run()
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[read-models] rebuild failed (${key}):`, msg);
        })
        .finally(() => {
          inFlight.delete(key);
        });
    }, DEBOUNCE_MS),
  );
}

/** @internal test helper */
export function flushReadModelDebounceForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
