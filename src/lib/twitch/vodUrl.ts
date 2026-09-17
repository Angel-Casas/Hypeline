export type VodInput = { vodId: string; startSec?: number } | { channel: string };

/**
 * Accepts a VOD id, a twitch.tv/videos/<id> URL (with optional ?t=1h2m3s), a channel-scoped
 * VOD URL, or — for live mode — a channel: `twitch.tv/<login>` or `#login`.
 */
export function parseVodInput(input: string): VodInput | null {
  const s = input.trim();
  if (/^\d{6,}$/.test(s)) return { vodId: s };
  if (/^#[a-z0-9_]{3,25}$/i.test(s)) return { channel: s.slice(1).toLowerCase() };
  let u: URL;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)twitch\.tv$/.test(u.hostname)) return null;
  const m = /\/videos\/(\d+)/.exec(u.pathname) ?? /\/video\/(\d+)/.exec(u.pathname);
  if (!m) {
    // twitch.tv/<login> (also the mobile m.twitch.tv form) → a live channel
    const c = /^\/([a-z0-9_]{3,25})\/?$/i.exec(u.pathname);
    if (c && !['videos', 'directory', 'settings', 'clips'].includes(c[1]!.toLowerCase()))
      return { channel: c[1]!.toLowerCase() };
    return null;
  }
  const out: { vodId: string; startSec?: number } = { vodId: m[1]! };
  const t = u.searchParams.get('t');
  if (t) {
    const tm = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    if (tm) out.startSec = Number(tm[1] ?? 0) * 3600 + Number(tm[2] ?? 0) * 60 + Number(tm[3] ?? 0);
  }
  return out;
}

export function formatHms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
