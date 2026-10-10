export const DEFAULT_DELAY_SECONDS = 15;
export function createPacer({ intervalMs = DEFAULT_DELAY_SECONDS * 1000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let nextAt = 0, chain = Promise.resolve();
  return {
    get nextAt() { return nextAt; },
    cooldown(ms) { nextAt = Math.max(nextAt, now() + ms); },
    async wait({ delayMs = intervalMs, signal, onWait } = {}) {
      const step = chain.then(async () => {
        while (now() < nextAt) {
          if (signal?.aborted) throw new Error('SCAN_CANCELLED');
          onWait?.(nextAt);
          await sleep(Math.min(nextAt - now(), 250));
        }
        if (signal?.aborted) throw new Error('SCAN_CANCELLED');
        nextAt = now() + delayMs;
      });
      chain = step.catch(() => {}); return step;
    },
  };
}
export function retryAfterMs(value, now = Date.now()) {
  const seconds = Number(value);
  const result = value && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value || '') - now;
  return Number.isFinite(result) && result > 0 ? Math.max(result, 30_000) : 60_000;
}
export const tiktokPacer = createPacer();
