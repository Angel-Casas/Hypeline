/**
 * What the app keeps in this browser, by kind, and how to let it go (Settings → Storage,
 * 2026-09-17). Angel saw 784 MB still "used" after removing every VOD: the browser's quota
 * figure counts everything on the origin — IndexedDB, the service worker's caches (the
 * 31 MB video engine, fonts, the app shell) — and Chrome reclaims deleted IndexedDB space
 * lazily, so the total can lag well behind a delete. This breakdown measures each kind
 * itself so the user sees what is actually there and can clear it kind by kind.
 */
import { clearStore, listAllClips, listAllChat, listAllAi, listVods } from './db';

export interface Kind {
  count: number;
  bytes: number;
}
export interface Breakdown {
  vods: Kind;
  clips: Kind;
  ai: Kind;
  /** Service-worker caches other than the app shell (video engine, fonts). */
  cache: Kind;
  /**
   * Data on this origin that is not ours: other IndexedDB databases and caches. On a dev
   * origin (localhost:5173) that is every other Vite project ever run on the port; the
   * browser's total counts it all, so it is listed and can be dropped too.
   */
  foreign: { databases: string[]; caches: string[] };
  /** Chrome's own split of the total (non-standard; absent elsewhere). */
  usageDetails: Record<string, number> | null;
}

/** Our database and the service-worker caches vite-plugin-pwa creates. */
const OWN_DB = 'hypeline';
const OWN_CACHE = /^(workbox-|fonts$|ffmpeg-core$)/;

async function foreignData(): Promise<Breakdown['foreign']> {
  const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
  const databases = idb?.databases
    ? (await idb.databases().catch(() => []))
        .map((d) => d.name ?? '')
        .filter((n) => n && n !== OWN_DB)
    : [];
  const cachesOut =
    typeof caches === 'undefined'
      ? []
      : (await caches.keys().catch(() => [])).filter((n) => !OWN_CACHE.test(n));
  return { databases, caches: cachesOut };
}

async function usageDetails(): Promise<Record<string, number> | null> {
  try {
    const est = (await navigator.storage.estimate()) as StorageEstimate & {
      usageDetails?: Record<string, number>;
    };
    return est.usageDetails ?? null;
  } catch {
    return null;
  }
}

/** UTF-16 JS strings ≈ 2 bytes a character on disk is pessimistic; IndexedDB stores UTF-8-ish. */
const textBytes = (v: unknown) => new Blob([JSON.stringify(v)]).size;

function isRuntimeCache(name: string) {
  return OWN_CACHE.test(name) && !/precache/i.test(name);
}

async function cacheSize(): Promise<Kind> {
  if (typeof caches === 'undefined') return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const name of await caches.keys()) {
    if (!isRuntimeCache(name)) continue;
    const c = await caches.open(name);
    for (const req of await c.keys()) {
      const res = await c.match(req);
      if (!res) continue;
      count++;
      const len = Number(res.headers.get('content-length'));
      bytes += Number.isFinite(len) && len > 0 ? len : (await res.clone().blob()).size;
    }
  }
  return { count, bytes };
}

export async function storageBreakdown(): Promise<Breakdown> {
  const [vods, chats, clips, ai, cache, foreign, details] = await Promise.all([
    listVods(),
    listAllChat(),
    listAllClips(),
    listAllAi(),
    cacheSize().catch(() => ({ count: 0, bytes: 0 })),
    foreignData(),
    usageDetails(),
  ]);
  return {
    vods: {
      count: vods.length,
      bytes: textBytes(vods) + chats.reduce((a, c) => a + textBytes(c.messages), 0),
    },
    clips: {
      count: clips.length,
      bytes: clips.reduce((a, c) => a + (c.blob?.size ?? c.bytes ?? 0), 0),
    },
    ai: { count: ai.length, bytes: textBytes(ai) },
    cache,
    foreign,
    usageDetails: details,
  };
}

/** Drop the other databases and caches on this origin (not ours; e.g. other dev projects). */
export async function clearForeign() {
  const f = await foreignData();
  await Promise.all([
    ...f.databases.map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
    ),
    ...f.caches.map((name) => caches.delete(name)),
  ]);
}

/** Every VOD with its chat, clips and AI results — what the library's × does, for all. */
export async function clearVods() {
  await Promise.all([
    clearStore('vods'),
    clearStore('chat'),
    clearStore('clips'),
    clearStore('ai'),
  ]);
}
export async function clearClips() {
  await clearStore('clips');
}
export async function clearAi() {
  await clearStore('ai');
}
/** The video engine and fonts; they are fetched again when next needed. The app shell stays. */
export async function clearAppCache() {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) if (isRuntimeCache(name)) await caches.delete(name);
}
/** All of the above, plus what is not ours. Settings and the NanoGPT key (localStorage) are kept. */
export async function eraseEverything() {
  await clearVods();
  await clearAppCache();
  await clearForeign();
}
