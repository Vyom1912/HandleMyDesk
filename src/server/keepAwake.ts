/*
 * Render's free plan stops a server after 15 minutes without visitors, and waking it again takes
 * up to a minute. While running, the server visits its own public address every 10 minutes, so
 * it never reaches 15 quiet minutes. Render counts these visits like any other.
 *
 * Render sets RENDER_EXTERNAL_URL (e.g. https://handlemydesk.onrender.com) by itself, so this only
 * runs on Render. KEEP_AWAKE_URL can name another address; KEEP_AWAKE=false turns it off
 * (not needed on a paid plan, which never sleeps).
 */

const EVERY_MS = 10 * 60 * 1000;

let lastOkAt: string | null = null;
let lastError: string | null = null;

export function startKeepAwake(): void {
  const base = (process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (!base || process.env.KEEP_AWAKE === 'false') return;
  const url = `${base}/api/health?source=keep-awake`;

  const visit = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'HandleMyDesk keep-awake' } });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      lastOkAt = new Date().toISOString();
      lastError = null;
    } catch (err: any) {
      // Try again sooner, so one failed visit doesn't let the server fall asleep
      if (!lastError) console.warn(`Keep-awake visit to ${base} failed (${err?.message ?? err}); retrying in 2 minutes.`);
      lastError = err?.message ?? String(err);
      setTimeout(visit, 2 * 60 * 1000).unref();
    }
  };

  // First visit shortly after start-up, then every 10 minutes
  setTimeout(visit, 60_000).unref();
  setInterval(visit, EVERY_MS).unref();
  console.log(`Keep-awake: visiting ${base} every 10 minutes so the free server doesn't sleep.`);
}

export const keepAwakeStatus = () => ({ lastOkAt, lastError });
