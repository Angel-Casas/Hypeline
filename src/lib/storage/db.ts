/** IndexedDB persistence (via `idb`). Everything is per-VOD and evictable. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChatMessage, VodInfo } from '@/lib/twitch/types';

export interface StoredClip {
  id: string;
  vodId: string;
  inSec: number;
  outSec: number;
  mode: 'fast' | 'precise';
  aspect: '16:9' | '9:16' | '1:1' | 'split';
  variant: string;
  captions?: boolean;
  bytes: number;
  createdAt: number;
  blob: Blob;
  /** The user's own label and tags (gallery, 2026-09-15). */
  title?: string;
  tags?: string[];
}

export interface StoredAiResult {
  /** `${vodId}:${inSec}-${outSec}:${kind}:${version}` */
  id: string;
  vodId: string;
  kind: 'transcript' | 'explain';
  inSec: number;
  outSec: number;
  model: string;
  /** Transcript text, or the explain JSON string. */
  content: string;
  costUsd: number | null;
  createdAt: number;
}

interface HypelineDB extends DBSchema {
  vods: { key: string; value: VodInfo & { fetchedAt: number } };
  chat: { key: string; value: { vodId: string; messages: ChatMessage[]; fetchedAt: number } };
  clips: { key: string; value: StoredClip; indexes: { byVod: string } };
  ai: { key: string; value: StoredAiResult; indexes: { byVod: string } };
}

const DB_VERSION = 3;
let dbPromise: Promise<IDBPDatabase<HypelineDB>> | null = null;

function db(): Promise<IDBPDatabase<HypelineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<HypelineDB>('hypeline', DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('vods', { keyPath: 'id' });
          d.createObjectStore('chat', { keyPath: 'vodId' });
        }
        if (oldVersion < 2) {
          const clips = d.createObjectStore('clips', { keyPath: 'id' });
          clips.createIndex('byVod', 'vodId');
        }
        if (oldVersion < 3) {
          const ai = d.createObjectStore('ai', { keyPath: 'id' });
          ai.createIndex('byVod', 'vodId');
        }
      },
    });
  }
  return dbPromise;
}

export async function getVod(id: string) {
  return (await db()).get('vods', id);
}
export async function putVod(v: VodInfo) {
  await (await db()).put('vods', { ...v, fetchedAt: Date.now() });
}
export async function getChat(vodId: string) {
  return (await db()).get('chat', vodId);
}
export async function putChat(vodId: string, messages: ChatMessage[]) {
  await (await db()).put('chat', { vodId, messages, fetchedAt: Date.now() });
}
export async function listVods() {
  return (await db()).getAll('vods');
}

export async function putClip(c: StoredClip) {
  await (await db()).put('clips', c);
}
export async function listClips(vodId: string): Promise<StoredClip[]> {
  const all = await (await db()).getAllFromIndex('clips', 'byVod', vodId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function listAllChat() {
  return (await db()).getAll('chat');
}
export async function listAllAi() {
  return (await db()).getAll('ai');
}
/** Empty one store (Settings → Storage). */
export async function clearStore(name: 'vods' | 'chat' | 'clips' | 'ai') {
  await (await db()).clear(name);
}
export async function listAllClips(): Promise<StoredClip[]> {
  const all = await (await db()).getAll('clips');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/** Change a clip's title / tags without rewriting its blob. */
export async function updateClipMeta(id: string, meta: { title?: string; tags?: string[] }) {
  const d = await db();
  const c = await d.get('clips', id);
  if (!c) return;
  await d.put('clips', { ...c, ...meta });
}
export async function deleteClip(id: string) {
  await (await db()).delete('clips', id);
}

export async function getAi(id: string) {
  return (await db()).get('ai', id);
}
export async function putAi(r: StoredAiResult) {
  await (await db()).put('ai', r);
}
export async function listAi(vodId: string) {
  return (await db()).getAllFromIndex('ai', 'byVod', vodId);
}

export async function deleteVodData(vodId: string) {
  const d = await db();
  const clipIds = (await d.getAllKeysFromIndex('clips', 'byVod', vodId)) as string[];
  const aiIds = (await d.getAllKeysFromIndex('ai', 'byVod', vodId)) as string[];
  await Promise.all([
    d.delete('vods', vodId),
    d.delete('chat', vodId),
    ...clipIds.map((id) => d.delete('clips', id)),
    ...aiIds.map((id) => d.delete('ai', id)),
  ]);
}
