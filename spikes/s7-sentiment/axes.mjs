/**
 * S7 — do emotion axes exist in chat, separately from volume? (spike, 2026-09-21)
 *
 * Angel's idea: a second layer on the heatmap where one emotion is drawn above the centre
 * line and its opposite below, as a toggle with a dropdown of axes. Before any of that we
 * need to know one thing: **is an emotion curve anything other than a fatter copy of the
 * volume curve?** If chat's laughter is just "more chat", the layer shows nothing new and
 * the feature is a re-skin of the heatmap we already have.
 *
 * Throwaway, per CLAUDE.md rule 5. Findings go to docs/05-research.md; nothing here is
 * meant to survive into src/.
 *
 *   node spikes/s7-sentiment/axes.mjs            # all three fixtures
 *   node spikes/s7-sentiment/axes.mjs --chart    # also render curves.png
 *
 * Method, deliberately close to what the app already does so the comparison is fair:
 * 15 s buckets, a ±600 s rolling-median baseline (scoring.ts DEFAULT_OPTIONS), bot badges
 * dropped. Each pole is counted in **distinct users**, not messages, so one person spamming
 * PepeHands forty times is one vote — the same crowd-confidence lesson as S3b.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = new URL('.', import.meta.url).pathname;
const BUCKET = 15;
const BASE_HALF = 600;

const FIXTURES = [
  ['tokyosims', 'src/features/hype/__tests__/fixtures/tokyosims_2871164819.jsonl'],
  ['caseoh_', 'src/features/hype/__tests__/fixtures/caseoh_2871808638.jsonl.gz'],
  ['popkreep_', 'src/features/hype/__tests__/fixtures/popkreep_2861002437.jsonl'],
];

/**
 * Three axes, two poles each. Seeded from the app's own MOOD_WORDS (scoring.ts) and
 * extended — the app's `grief` mixes real sorrow (sadge, pepehands) with defeat (L, copium),
 * and its `shock` mixes dread (monkaS) with surprise (wtf, omg). Those are different axes in
 * Angel's scheme, so they are re-cut here. Every token belongs to exactly one pole: a token
 * counted on two poles would manufacture the correlation we are trying to measure.
 */
const AXES = [
  {
    key: 'joy-sorrow',
    up: {
      key: 'joy',
      words: `lol lmao lmfao lmaoo kekw kek kekl lul lulw omegalul icant dead deadass
              pepelaugh haha hahaha ahah xd jaja jajaja 😂 🤣 kekwait lmfaoo crying laughing`,
    },
    down: {
      key: 'sorrow',
      words: `sadge pepehands feelsbadman widepeeposad peepocry sadcat 😭 😢 🥺 💔 sad
              rip cry heartbroken poor awww aww nooo 🙏 restinpeace`,
    },
  },
  {
    key: 'hype-letdown',
    up: {
      key: 'hype',
      words: `pog poggers pogchamp pogu pogcrazy letsgo lfg gg hype goat wooo sheesh
              insane clutch cracked 🔥 w ww www dub actualgamer`,
    },
    down: {
      key: 'letdown',
      words: `l ll lll copium aware notlikethis choke choked unlucky malding yikes oof
              damn washed mid trash cope sadgechamp`,
    },
  },
  {
    key: 'dread-relief',
    up: {
      key: 'dread',
      words: `monkas monkaw monkahmm monkaeyes pausechamp 😬 uhoh ohno scared nervous
              sweating anxiety terrifying creepy`,
    },
    down: {
      key: 'relief',
      words: `phew ezclap ez saved safe finally relief exhale thankgod whew survived`,
    },
  },
];
for (const a of AXES) for (const p of [a.up, a.down]) p.set = new Set(p.words.split(/\s+/).filter(Boolean));

// a token in two poles would invent the very correlation we are measuring — refuse to run
{
  const seen = new Map();
  for (const a of AXES)
    for (const p of [a.up, a.down])
      for (const w of p.set) {
        if (seen.has(w)) throw new Error(`token "${w}" is in both ${seen.get(w)} and ${p.key}`);
        seen.set(w, p.key);
      }
}
const POLES = AXES.flatMap((a) => [a.up, a.down]);

const WORD_RE = /[a-z0-9À-ɏ぀-ヿ一-鿿]+|[\u{1F300}-\u{1FAFF}☀-➿]/gu;

function load(path) {
  const raw = path.endsWith('.gz')
    ? gunzipSync(readFileSync(join(ROOT, path))).toString('utf8')
    : readFileSync(join(ROOT, path), 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.b?.includes('bot-badge')) continue; // the discord-link bot posts 126 identical lines
    rows.push(m);
  }
  return rows;
}

/** Rolling median over a window of `half` seconds either side — the app's baseline. */
function rollingMedian(values, halfBuckets) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - halfBuckets);
    const hi = Math.min(values.length - 1, i + halfBuckets);
    const w = values.slice(lo, hi + 1).sort((a, b) => a - b);
    out[i] = w[Math.floor(w.length / 2)];
  }
  return out;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function analyse(name, rows, BUCKET) {
  const span = rows[rows.length - 1].t;
  const nb = Math.ceil(span / BUCKET) + 1;
  const msgs = new Array(nb).fill(0);
  const users = Array.from({ length: nb }, () => new Set());
  const poleUsers = {};
  for (const p of POLES) poleUsers[p.key] = Array.from({ length: nb }, () => new Set());
  const lines = Array.from({ length: nb }, () => []);

  for (const m of rows) {
    const i = Math.floor(m.t / BUCKET);
    if (i < 0 || i >= nb) continue;
    msgs[i]++;
    users[i].add(m.u);
    const toks = new Set((m.m.toLowerCase().match(WORD_RE) ?? []).concat((m.e ?? []).map((e) => e.toLowerCase())));
    for (const p of POLES) {
      for (const tok of toks)
        if (p.set.has(tok)) {
          poleUsers[p.key][i].add(m.u);
          // keep the matching line *and the token that matched it*: a pole is only worth
          // drawing if the lines behind a peak read like the emotion it claims
          if (lines[i].length < 60) lines[i].push({ pole: p.key, tok, m: m.m });
          break;
        }
    }
  }

  const u = users.map((s) => s.size);
  const rateBase = rollingMedian(msgs, Math.round(BASE_HALF / BUCKET));
  // the app's `rate`: how far above its own baseline this bucket's volume is
  const rate = msgs.map((n, i) => Math.log2((n + 0.5) / (rateBase[i] + 0.5)));

  const poles = {};
  for (const p of POLES) {
    const cnt = poleUsers[p.key].map((s) => s.size);
    // share of the people *present* who took this pole — the volume-independent quantity
    const share = cnt.map((c, i) => (u[i] > 0 ? c / u[i] : 0));
    const base = rollingMedian(share, Math.round(BASE_HALF / BUCKET));
    const lift = share.map((s, i) => Math.log2((s + 0.02) / (base[i] + 0.02)));
    poles[p.key] = { cnt, share, lift, total: cnt.reduce((s, v) => s + v, 0) };
  }
  return { name, span, nb, bucket: BUCKET, msgs, u, rate, poles, lines };
}

/**
 * The bucket has to hold a crowd, and how long that takes depends entirely on the channel.
 * caseoh_ has ~97 people talking every 15 s; popkreep_ has 2. An emotion needs several
 * people agreeing before it is an emotion rather than one viewer, so the window widens until
 * it contains enough of them. The hype heatmap can stay at 15 s — it only needs messages,
 * and one person can supply those.
 */
const TARGET_USERS = 12;
function pickBucket(rows) {
  const probe = analyse('probe', rows, BUCKET);
  const med = [...probe.u].sort((a, b) => a - b)[Math.floor(probe.nb / 2)] || 0;
  const mult = med >= TARGET_USERS ? 1 : Math.min(8, Math.max(1, Math.round(TARGET_USERS / Math.max(med, 0.5))));
  return { bucket: BUCKET * mult, medAt15: med };
}

const results = [];
for (const [name, path] of FIXTURES) {
  const rows = load(path);
  const { bucket, medAt15 } = pickBucket(rows);
  const r = analyse(name, rows, bucket);
  results.push(r);
  const mins = (r.span / 60).toFixed(0);
  console.log(
    `\n══ ${name} — ${rows.length} msgs, ${mins} min, ${r.nb} buckets of ${bucket}s` +
      `  (${medAt15} users per 15s → widened ×${bucket / BUCKET})`,
  );
  console.log('   pole      users-tagged   r(count,volume)   r(share,volume)   r(lift,rate)');
  for (const p of POLES) {
    const d = r.poles[p.key];
    const rc = pearson(d.cnt, r.msgs).toFixed(2).padStart(5);
    const rs = pearson(d.share, r.msgs).toFixed(2).padStart(5);
    const rl = pearson(d.lift, r.rate).toFixed(2).padStart(5);
    console.log(
      `   ${p.key.padEnd(9)} ${String(d.total).padStart(8)}` +
        `        ${rc}             ${rs}             ${rl}`,
    );
  }
}

/* ── the question that decides the feature ──────────────────────────────────────────────
   A moment the volume scorer cannot see: the pole is well above its own baseline while the
   bucket's volume is at or below its own. If this list is empty, the layer adds nothing. */
console.log('\n\n════ moments high on a pole but flat on volume (what the heatmap misses) ════');
for (const r of results) {
  console.log(`\n── ${r.name}`);
  for (const p of POLES) {
    const d = r.poles[p.key];
    const hits = [];
    for (let i = 0; i < r.nb; i++) {
      if (d.lift[i] > 1.2 && r.rate[i] < 0.3 && d.cnt[i] >= 4) hits.push(i);
    }
    hits.sort((a, b) => d.lift[b] - d.lift[a]);
    if (!hits.length) { console.log(`   ${p.key}: none`); continue; }
    console.log(`   ${p.key}: ${hits.length} buckets`);
    for (const i of hits.slice(0, 2)) {
      const at = i * r.bucket;
      const hh = String(Math.floor(at / 3600)).padStart(2, '0');
      const mm = String(Math.floor((at % 3600) / 60)).padStart(2, '0');
      const ss = String(at % 60).padStart(2, '0');
      console.log(
        `      ${hh}:${mm}:${ss}  lift ${d.lift[i].toFixed(1)}  rate ${r.rate[i].toFixed(1)}  ` +
          `${d.cnt[i]}/${r.u[i]} users`,
      );
      for (const l of r.lines[i].filter((l) => l.pole === p.key).slice(0, 6))
        console.log(`          ·[${l.tok}] ${l.m.slice(0, 80)}`);
    }
  }
}

/* Why a fixture finds nothing: not enough people per bucket to ever clear a crowd
   threshold, or plenty of people but no emotional separation. Different fixes. */
console.log('\n\n════ density: does the widened bucket carry a crowd? ════');
for (const r of results) {
  const busy = r.u.filter((n) => n >= 4).length;
  console.log(
    `${r.name.padEnd(11)} median users/bucket ${[...r.u].sort((a, b) => a - b)[Math.floor(r.nb / 2)]
      .toString().padStart(3)}   buckets with >=4 users: ${busy}/${r.nb} (${((100 * busy) / r.nb).toFixed(0)}%)`,
  );
  for (const p of POLES) {
    const d = r.poles[p.key];
    const reach = d.cnt.filter((c) => c >= 4).length;
    console.log(
      `   ${p.key.padEnd(9)} buckets with >=4 of its users: ${String(reach).padStart(4)}   max lift ${Math.max(...d.lift).toFixed(1)}`,
    );
  }
}

writeFileSync(join(OUT, 'axes.json'), JSON.stringify(results.map((r) => ({
  name: r.name, span: r.span, msgs: r.msgs, u: r.u, rate: r.rate,
  poles: Object.fromEntries(Object.entries(r.poles).map(([k, v]) => [k, { share: v.share, lift: v.lift, total: v.total }])),
})), null, 1));
console.log('\nwrote axes.json');
