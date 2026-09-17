/**
 * Generates src/features/vod/demo/demoSeries.json from the tokyosims fixture
 * so the landing page can show a real hype thread before any VOD is loaded.
 * Run: npx tsx scripts/gen-demo-series.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analyse } from '../src/features/hype/scoring';
import type { ChatMessage } from '../src/lib/twitch/types';

const raw = readFileSync('src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as ChatMessage);
const lengthSeconds = 23042;
const { buckets, moments } = analyse(raw, '2871164819', lengthSeconds, 6);
const out = {
  streamer: 'tokyosims',
  lengthSeconds,
  messages: raw.length,
  scores: buckets.map((b) => Number(b.score.toFixed(3))),
  moments: moments.slice(0, 5).map((m) => ({ t: m.t, score: Number(m.score.toFixed(2)), users: m.users, reasons: m.reasons })),
};
writeFileSync('src/features/vod/demo/demoSeries.json', JSON.stringify(out));
console.log(out.scores.length, 'buckets,', out.moments.length, 'moments', out.moments.map((m) => m.t));
