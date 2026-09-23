/**
 * S7d — the love ↔ hate lexicon, read in context (spike, 2026-09-23, ADR-44).
 *
 * Every candidate token for the new axis, counted across the five real chats we hold
 * (356k messages) with the first few lines it matched, so a word is admitted on what chat
 * actually means by it and not on the dictionary — the `ez` lesson of S7c. Findings in
 * docs/05-research.md; the words that survived are in src/features/hype/emotion.ts.
 *
 *   node spikes/s7-sentiment/lovehate.mjs
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const files = [
  'spikes/s7-sentiment/xqc_2879641133.jsonl.gz',
  'spikes/s7-sentiment/hasgarson_2877241107.jsonl.gz',
  'src/features/hype/__tests__/fixtures/caseoh_2871808638.jsonl.gz',
  'src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl',
  'src/features/hype/__tests__/fixtures/popkreep_2861002437.jsonl',
];
const RE = /[\p{L}\p{N}]+|\p{Extended_Pictographic}/gu;
const LOVE =
  '❤️ ❤ 💜 💖 💕 💗 😍 🥰 love loved lovely wholesome peepolove catlove pepelove king queen legend based cute adorable precious protect blessed ily marry wife husband hug peepohug cutie sweet gigachad respect proud goated cutest ilove loveyou 🫶 🥹 heart hearts'.split(
    ' ',
  );
const HATE =
  'ratio cringe trash boo unsub clown 🤡 bozo loser garbage scam scammer fraud ick gross disgusting ew eww yuck hate hated worst terrible awful 🤮 🤢 👎 stfu toxic dogshit 🖕 dislike shutup annoying bad boring cringy weirdo creep pathetic embarrassing lame nobody cares'.split(
    ' ',
  );
const cnt = {},
  ex = {};
let total = 0;
for (const f of files) {
  const raw = f.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString() : readFileSync(f, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line);
    total++;
    const toks = new Set([
      ...(o.m.toLowerCase().match(RE) ?? []),
      ...(o.e ?? []).map((e) => String(e).toLowerCase()),
    ]);
    for (const w of [...LOVE, ...HATE])
      if (toks.has(w)) {
        cnt[w] = (cnt[w] || 0) + 1;
        (ex[w] ??= []).length < 4 && ex[w].push(o.m.slice(0, 60));
      }
  }
}
console.log('messages', total);
for (const [name, list] of [
  ['LOVE', LOVE],
  ['HATE', HATE],
]) {
  console.log('--', name);
  for (const w of list)
    if (cnt[w]) console.log(String(cnt[w]).padStart(5), w, '|', (ex[w] || []).join(' || '));
}
