<script setup lang="ts">
/**
 * The hype timeline: the hype thread as a clean SVG ribbon (the landing keeps the WebGL
 * silk), and the place where most of the clipping happens:
 *
 *  - hover: a glass readout (time, hype ×, chatters, what chat was saying) and, when a
 *    storyboard is available, the video frame at that second
 *  - pins ↔ moments: hovering a pin lights the row in the list (and vice versa); clicking a
 *    pin selects the moment (seek + clip range + zoom)
 *  - brush: drag on the ribbon to paint the In→Out range; the handles then trim it
 *  - wheel / trackpad pinch: zoom around the pointer; Shift+wheel or horizontal wheel pans;
 *    two fingers on a touchscreen zoom and pan together (2026-09-17); when
 *    zoomed, a minimap under the ribbon shows the window and can be dragged
 *  - marks: exported clips as ink brackets, grabbed thumbnails as tiny frames
 *  - a light pulse runs along the ribbon from where you clicked (seek)
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Bucket, Moment } from '../scoring';
import type { LaneProgress } from '@/lib/twitch/chat';
import { burst } from '../burst';
import type { ChatMessage } from '@/lib/twitch/types';
import type { Storyboard } from '@/lib/twitch/storyboard';
import { frameAt } from '@/lib/twitch/storyboard';
import { formatHms } from '@/lib/twitch/vodUrl';
import { peaksFromMoments, seriesFromPeaks } from '@/ui/thread/series';
import {
  axisOf,
  axisScale,
  isUpper,
  POLE_KEY,
  SMOOTH_SIGMA,
  type AxisKey,
  type EmotionSeries,
  type PoleKey,
} from '../emotion';

const props = withDefaults(
  defineProps<{
    buckets: Bucket[];
    moments: Moment[];
    lengthSeconds: number;
    currentTime: number;
    inSec?: number | null;
    outSec?: number | null;
    /** Visible window (VOD seconds); omit for the whole VOD. Controlled by the parent. */
    viewStart?: number | null;
    viewEnd?: number | null;
    /** Chat replay, sorted by time — for the hover readout. */
    messages?: ChatMessage[];
    storyboard?: Storyboard | null;
    /** Exported clips (ink brackets) and grabbed thumbnails (tiny frames). */
    clips?: { inSec: number; outSec: number }[];
    thumbs?: number[];
    /** Moment currently hovered anywhere (list or pins) and the active one. */
    hoverId?: string | null;
    activeId?: string | null;
    /**
     * While the chat replay is still being fetched: per-lane coverage. The ribbon grows in
     * where lanes have reached, with an ink hairline + dot at each lane's front.
     */
    loading?: { start: number; end: number; covered: number }[] | null;
    /** A VOD still recording: where it ends right now (a beating dot at the ribbon's edge). */
    liveEdge?: number | null;
    /**
     * The emotion layer (ADR-43): what chat felt, mirrored about the spine — the warm pole
     * above, the cool one below. Null when the layer is off, which is the default.
     */
    emotion?: EmotionSeries | null;
    emotionAxis?: AxisKey | null;
    /**
     * The transcript: chunks already transcribed (an accent band under the ribbon, so you
     * can see what the AI can search) and, while a whole-VOD transcription runs, the target
     * range and the chunk being worked on (a scanning light over the ribbon).
     */
    transcript?: {
      chunks: { startSec: number; endSec: number }[];
      running: { fromSec: number; toSec: number; current: [number, number] | null } | null;
    } | null;
  }>(),
  {
    inSec: null,
    outSec: null,
    viewStart: null,
    viewEnd: null,
    messages: () => [],
    storyboard: null,
    clips: () => [],
    thumbs: () => [],
    hoverId: null,
    activeId: null,
    loading: null,
    liveEdge: null,
    emotion: null,
    emotionAxis: null,
    transcript: null,
  },
);
const emit = defineEmits<{
  seek: [sec: number];
  'update:in': [sec: number];
  'update:out': [sec: number];
  /** Visible window changed (null = whole VOD). */
  'update:view': [view: { start: number; end: number } | null];
  /** A pin was hovered (id) or unhovered (null). */
  'hover-moment': [id: string | null];
  /** A pin was clicked: select that moment. */
  select: [m: Moment];
  /** The range was dragged shut (brushed back to nothing, or a handle onto the other). */
  'clear-range': [];
}>();

const { t } = useI18n();
const W = 1000;
const H = 120;
const MH = 36; // minimap height
const svg = ref<SVGSVGElement | null>(null);
const wrap = ref<HTMLElement | null>(null);
/**
 * The SVG is stretched to the box (preserveAspectRatio="none"), so anything round drawn in
 * viewBox units squashes as the box narrows — on a phone the pin dots became slivers. Dots
 * and hit areas are therefore sized in screen pixels: `sx` / `sy` convert px → viewBox units.
 */
const BOX_H = 176; // the ribbon box is h-44
const wrapW = ref(1000);
const sx = computed(() => W / Math.max(1, wrapW.value));
const sy = H / BOX_H;
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!wrap.value) return;
  wrapW.value = wrap.value.clientWidth || 1000;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      wrapW.value = wrap.value?.clientWidth || wrapW.value;
    });
    ro.observe(wrap.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const bucketSec = computed(() =>
  props.buckets.length > 1 ? props.buckets[1]!.t - props.buckets[0]!.t : 15,
);
const total = computed(() => Math.max(props.lengthSeconds, props.buckets.length * bucketSec.value));
const zoomed = computed(() => props.viewStart != null && props.viewEnd != null);
/** The window the parent asked for. */
const target = computed(() => ({
  start: Math.max(0, props.viewStart ?? 0),
  end: Math.min(total.value, props.viewEnd ?? total.value),
}));
/**
 * The window actually drawn: it glides to `target` (van Wijk–Nuij pan-and-zoom, 0.7–1.4 s, smootherstep)
 * unless the change came from the user's own wheel / minimap drag, which is instant.
 */
const shown = ref({ start: 0, end: 0 });
let anim = 0;
const reduceMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// smootherstep: gentle start and finish, no lurch at either end
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function glideTo(to: { start: number; end: number }, instant: boolean) {
  cancelAnimationFrame(anim);
  const from = { ...shown.value };
  const same = Math.abs(from.start - to.start) < 0.01 && Math.abs(from.end - to.end) < 0.01;
  if (instant || reduceMotion || same || from.end <= from.start) {
    shown.value = { ...to };
    return;
  }
  // van Wijk & Nuij (2003) smooth pan-and-zoom: one path where the pan and the zoom are
  // coupled (zoom out, fly, zoom in) and arrive together — no pan still moving after the zoom
  // has settled. Units: seconds; w = window span, u = window centre.
  const rho = 1.42;
  const u0 = (from.start + from.end) / 2;
  const u1 = (to.start + to.end) / 2;
  const w0 = Math.max(1, from.end - from.start);
  const w1 = Math.max(1, to.end - to.start);
  const du = Math.abs(u1 - u0);
  const dir = u1 >= u0 ? 1 : -1;
  let S: number;
  let at: (s: number) => { u: number; w: number };
  if (du < 1e-6) {
    // pure zoom
    S = Math.abs(Math.log(w1 / w0)) / rho;
    at = (s) => ({ u: u0, w: w0 * Math.exp(dir * rho * s * Math.sign(Math.log(w1 / w0))) });
  } else {
    const b = (i: number) => {
      const wi = i === 0 ? w0 : w1;
      const sign = i === 0 ? 1 : -1;
      return (w1 * w1 - w0 * w0 + sign * Math.pow(rho, 4) * du * du) / (2 * wi * rho * rho * du);
    };
    const r = (i: number) => {
      const bi = b(i);
      return Math.log(-bi + Math.sqrt(bi * bi + 1));
    };
    const r0 = r(0);
    const r1 = r(1);
    S = (r1 - r0) / rho;
    at = (s) => {
      const rs = r0 + rho * s;
      const u = u0 + dir * ((w0 / (rho * rho)) * (Math.cosh(r0) * Math.tanh(rs) - Math.sinh(r0)));
      const w = (w0 * Math.cosh(r0)) / Math.cosh(rs);
      return { u, w };
    };
  }
  const t0 = performance.now();
  const D = Math.min(1400, Math.max(700, S * 260)); // longer flights take a little longer
  const step = (now: number) => {
    const k = ease(Math.min(1, (now - t0) / D));
    const { u, w } = at(k * S);
    shown.value = { start: u - w / 2, end: u + w / 2 };
    if (k < 1) anim = requestAnimationFrame(step);
    else shown.value = { ...to };
  };
  anim = requestAnimationFrame(step);
}
watch(target, (t) => glideTo(t, false), { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(anim));
const v0 = computed(() => Math.max(0, shown.value.start));
const v1 = computed(() => Math.min(total.value, shown.value.end));
const span = computed(() => Math.max(1, v1.value - v0.value));
const x = (sec: number) => ((sec - v0.value) / span.value) * W;
const xm = (sec: number) => (sec / total.value) * W; // minimap
const barW = computed(() => Math.max(0.5, (bucketSec.value / span.value) * W));

// --- the ribbon ---
const series = computed(() =>
  seriesFromPeaks(
    peaksFromMoments(
      props.moments.filter((m) => m.source !== 'ai'),
      total.value,
    ),
    { n: 1024, width: 0.02 },
  ),
);
/**
 * The hype curve actually drawn. While chat is loading the series is rescored every few
 * hundred ms; instead of jumping, the drawn curve tweens to each new series (450 ms), so peaks
 * grow out of the spine.
 */
const drawn = ref<Float32Array>(new Float32Array(1024));
let curveAnim = 0;
watch(
  series,
  (to, prev) => {
    cancelAnimationFrame(curveAnim);
    const from = Float32Array.from(
      drawn.value.length === to.n ? drawn.value : new Float32Array(to.n),
    );
    if (!prev || reduceMotion || (!props.loading && !prev.hype.some((v) => v > 0))) {
      drawn.value = Float32Array.from(to.hype);
      return;
    }
    const t0 = performance.now();
    const D = 450;
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / D));
      const out = new Float32Array(to.n);
      for (let i = 0; i < to.n; i++) out[i] = from[i]! + (to.hype[i]! - from[i]!) * k;
      drawn.value = out;
      if (k < 1) curveAnim = requestAnimationFrame(step);
    };
    curveAnim = requestAnimationFrame(step);
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(curveAnim));
const amp = (h: number, height: number) => height * 0.012 + height * 0.42 * Math.min(1, h);
function hypeAt(sec: number): number {
  const hype = drawn.value;
  const n = hype.length;
  const f = Math.max(0, Math.min(n - 1, (sec / total.value) * n - 0.5));
  const i = Math.floor(f);
  const a = hype[i] ?? 0;
  const b = hype[Math.min(n - 1, i + 1)] ?? a;
  return a + (b - a) * (f - i); // linear between samples: no stair-steps when zoomed in
}
/**
 * In a zoom window the ribbon shows the window's own shape: its lowest point sits near the
 * spine and its highest near the top (local contrast), so a slice of a broad bump still reads
 * as a curve instead of a flat slab. Whole-VOD view: the series as is.
 */
const local = computed(() => {
  if (!zoomed.value) return null;
  let lo = Infinity;
  let hi = 0;
  for (let k = 0; k <= 80; k++) {
    const h = hypeAt(v0.value + (k / 80) * span.value);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { lo, hi: Math.max(hi, lo + 0.02) };
});
function shaped(h: number): number {
  const l = local.value;
  if (!l) return h;
  return 0.12 + 0.78 * ((h - l.lo) / (l.hi - l.lo));
}
function ribbonPath(from: number, to: number, height: number, scale: number): string {
  const N = 240;
  const top: string[] = [];
  const bot: string[] = [];
  for (let k = 0; k <= N; k++) {
    const sec = from + (k / N) * (to - from);
    const a = amp(scale < 0 ? hypeAt(sec) : shaped(hypeAt(sec)), height);
    const px = ((k / N) * W).toFixed(1);
    top.push(`${k ? 'L' : 'M'}${px} ${(height / 2 - a).toFixed(2)}`);
    bot.push(`L${px} ${(height / 2 + a).toFixed(2)}`);
  }
  return top.join(' ') + ' ' + bot.reverse().join(' ') + ' Z';
}
/**
 * The emotion layer, mirrored about the same spine the ribbon already uses.
 *
 * The two poles are drawn as two curves and **never subtracted**: joy outnumbers sorrow four
 * or five to one, so a difference would erase the rare pole in every bucket it appeared in,
 * and a bucket where chat is both hysterical and gutted — the best kind there is — would
 * render as a flat line.
 *
 * Scaled by `axisScale`: the tallest point of the smoothed curve across both poles and the
 * whole VOD, but never below a floor, so an axis with nothing much to say draws quietly
 * instead of normalising its own noise up to full height. Not the visible window, so zooming
 * cannot make a small feeling look big; and not a percentile with the rest clipped, which is
 * the mistake the thread already made and fixed on 2026-09-14 — clipping gives a peak a flat
 * top and two corners. The moment picker uses this same scale, so what is drawn and what is
 * offered cannot drift apart.
 */
const emoAxis = computed(() => (props.emotion && props.emotionAxis ? axisOf(props.emotionAxis) : null));
const emoOn = computed(() => emoAxis.value != null);

/** The same scale the moment picker measures peaks against, so the two cannot disagree. */
const emoScale = computed(() =>
  props.emotion && props.emotionAxis ? axisScale(props.emotion, props.emotionAxis) : 1,
);

/**
 * Gaussian blur over the bucket series, the way `buildSeries` smooths the thread's.
 *
 * Interpolating raw buckets linearly gave straight runs meeting at corners — a polyline, not
 * silk (Angel, 2026-09-21). The design system already answered this for the thread: the raw
 * bucket series is too jagged to read, so it is drawn as a smooth swell per moment. The mood
 * ribbon cannot borrow that machinery directly — `seriesFromPeaks` normalises each series to
 * its own maximum, which would make a small sorrow lobe look as tall as a big joy one and
 * destroy the very comparison the mirror exists for — so it takes the same *treatment*
 * instead: blur the buckets, keep one shared scale across the axis.
 */
/**
 * The two poles, as confidence-weighted strength rather than raw share, un-smoothed — the
 * continuous kernel below does the smoothing. `strength` discounts a share measured on very
 * few people, which is what stops one chatter in a quiet minute from painting a full-height
 * peak that the moment list would then refuse to offer (Angel, 2026-09-21).
 */
const emoRaw = computed<{ up: readonly number[]; down: readonly number[] } | null>(() => {
  const s = props.emotion;
  const a = emoAxis.value;
  if (!s || !a) return null;
  return { up: s.poles[a.up.key].strength, down: s.poles[a.down.key].strength };
});

/**
 * A pole's share at a second, as a continuous function.
 *
 * Blurring the bucket array and then joining the results with straight lines still leaves a
 * corner at every bucket centre — smaller corners, but a polyline all the same, which is
 * what Angel could still see. Evaluating the gaussian at the sampled second instead makes
 * the curve smooth everywhere by construction rather than by resolution: there is no
 * underlying polygon to catch the light. It costs ~9 multiply-adds per sample.
 */
function shareAt(pole: 'up' | 'down', sec: number): number {
  const s = props.emotion;
  const raw = emoRaw.value;
  if (!s || !raw) return 0;
  const series = raw[pole];
  const sigma = SMOOTH_SIGMA * s.bucketSec;
  const at = sec / s.bucketSec - 0.5; // in bucket units, centres on the half
  // 4σ, not 3σ: the window is recomputed per sample, so a bucket entering or leaving it
  // steps the sum by its edge weight — a tiny corner at every bucket boundary. At 3σ that
  // weight is 1.1 %, which was still measurable in the path; at 4σ it is 0.03 %.
  const r = Math.ceil(SMOOTH_SIGMA * 4);
  const lo = Math.max(0, Math.floor(at) - r);
  const hi = Math.min(series.length - 1, Math.ceil(at) + r);
  let acc = 0;
  let wsum = 0;
  for (let j = lo; j <= hi; j++) {
    const d = (sec - (j + 0.5) * s.bucketSec) / sigma;
    const w = Math.exp(-0.5 * d * d);
    acc += (series[j] ?? 0) * w;
    wsum += w;
  }
  return wsum > 0 ? acc / wsum : 0;
}

/** How far off the spine a pole reaches at `sec`, in viewBox units. */
function emoAmp(pole: 'up' | 'down', sec: number): number {
  const room = (H / 2 - 5) * 0.9;
  // no clamp: the scale is the curve's own maximum, so nothing can exceed the room
  return (shareAt(pole, sec) / emoScale.value) * room;
}

/**
 * The mood ribbon: built exactly like `ribbonPath`, one closed shape whose top edge is the
 * upper pole and whose bottom edge is the lower one. The hype ribbon is symmetric about the
 * spine; this one is not, and that asymmetry *is* the reading — but it is the same object,
 * so it takes the same three layers (halo, fill, sheen) and the same silk.
 */
const emoRibbon = computed(() => {
  if (!emoOn.value) return '';
  // twice the thread's sample count: the thread is a handful of wide swells, while a mood
  // curve can turn inside one bucket, and at 240 the polygon behind it was still catching
  // the light (Angel, 2026-09-21)
  const N = 480;
  const mid = H / 2;
  const top: string[] = [];
  const bot: string[] = [];
  for (let k = 0; k <= N; k++) {
    const sec = v0.value + (k / N) * span.value;
    const px = ((k / N) * W).toFixed(1);
    top.push(`${k ? 'L' : 'M'}${px} ${(mid - emoAmp('up', sec)).toFixed(2)}`);
    bot.push(`L${px} ${(mid + emoAmp('down', sec)).toFixed(2)}`);
  }
  return top.join(' ') + ' ' + bot.reverse().join(' ') + ' Z';
});
/** The pole names, for the labels that keep identity off colour alone. */
const emoLabels = computed(() => {
  const a = emoAxis.value;
  return a ? { up: t(POLE_KEY[a.up.key]), down: t(POLE_KEY[a.down.key]) } : null;
});

const ribbon = computed(() => ribbonPath(v0.value, v1.value, H, 1));
const miniRibbon = computed(() => ribbonPath(0, total.value, MH, -1)); // raw series
const gid = `hl${Math.random().toString(36).slice(2, 7)}`;
/** Loading: the covered stretches of the VOD (clip for the ribbon) and each lane's front. */
const covered = computed(() =>
  (props.loading ?? [])
    .filter((l: LaneProgress) => l.covered > l.start)
    .map((l: LaneProgress) => ({
      x0: x(l.start),
      x1: x(Math.min(l.covered, l.end)),
      // a finished lane is drawn solid to its end: no fade left behind once its front is gone
      done: l.covered >= l.end - 1,
    })),
);
const heads = computed(() =>
  (props.loading ?? [])
    .filter((l: LaneProgress) => l.covered > l.start && l.covered < l.end - 1)
    .map((l: LaneProgress) => x(l.covered)),
);
const isLoading = computed(() => !!props.loading);
/** Transcribed stretches (merged when contiguous), in the visible window. */
const transcribed = computed(() => {
  const cs = props.transcript?.chunks ?? [];
  if (!cs.length) return [] as { a: number; b: number }[];
  const out: { a: number; b: number }[] = [];
  for (const c of [...cs].sort((p, q) => p.startSec - q.startSec)) {
    const last = out[out.length - 1];
    if (last && c.startSec <= last.b + 1) last.b = Math.max(last.b, c.endSec);
    else out.push({ a: c.startSec, b: c.endSec });
  }
  return out.filter((r) => r.b > v0.value && r.a < v1.value);
});
const transcribing = computed(() => props.transcript?.running ?? null);
/** The live edge to draw: inside the visible window, never past the drawn length. */
const edgeSec = computed(() => {
  const e = props.liveEdge;
  if (e == null || e < v0.value) return null;
  return Math.min(e, v1.value);
});
/** The LIVE pill's left edge in CSS px (it hangs to the left of the edge line). */
const edgePx = computed(() =>
  edgeSec.value == null ? 0 : ((edgeSec.value - v0.value) / span.value) * wrapW.value,
);
/**
 * With a mood chosen, the pins belong to *that* mood: the rate peaks are still in the list
 * below (dimmed, one click away) but on the ribbon they would be pins for a shape that is no
 * longer drawn (Angel, 2026-09-21). AI pins stay either way — the user asked for those.
 */
const visibleMoments = computed(() =>
  props.moments.filter(
    (m) =>
      m.t >= v0.value &&
      m.t < v1.value &&
      (!emoOn.value || m.source === 'emotion' || m.source === 'ai'),
  ),
);
/**
 * A pin hangs off the spine towards the lobe it belongs to. The thread is symmetric, so its
 * pins always rose; a mood ribbon is not, and a moment that lives under the line wants its
 * pin under the line too — otherwise the marker for "chat was gutted" points at empty sky.
 */
const pinDown = (m: Moment) =>
  emoOn.value && m.source === 'emotion' && !!m.pole && !isUpper(m.pole as PoleKey);
/** The tip of the pin: past whichever curve is on screen, on the pin's own side. */
const pinTop = (m: Moment) => {
  if (!emoOn.value) return Math.max(7, H / 2 - amp(shaped(hypeAt(m.t)), H) - 6);
  return pinDown(m)
    ? Math.min(H - 7, H / 2 + emoAmp('down', m.t) + 6)
    : Math.max(7, H / 2 - emoAmp('up', m.t) - 6);
};
/** The dot sits just beyond the tip, on the same side. */
const pinDot = (m: Moment) => pinTop(m) + (pinDown(m) ? 2 : -2);
/** The hit area spans spine → tip whichever way that runs. */
const pinRect = (m: Moment) => {
  const tip = pinTop(m);
  const pad = 14 * sy;
  return { y: Math.min(H / 2, tip) - pad, height: Math.abs(H / 2 - tip) + 2 * pad };
};
const hasRange = computed(() => props.inSec != null && props.outSec != null);

const ticks = computed(() => {
  const step = span.value > 7200 ? 1800 : span.value > 1200 ? 300 : span.value > 240 ? 30 : 10;
  const out: number[] = [];
  for (let s = Math.ceil(v0.value / step) * step; s <= v1.value; s += step) out.push(s);
  return out;
});

// --- pointer: hover readout, brush, handles, click ---
function secFromEvent(e: MouseEvent | PointerEvent): number {
  const el = svg.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return Math.max(
    v0.value,
    Math.min(v1.value, v0.value + ((e.clientX - r.left) / r.width) * span.value),
  );
}
const hoverSec = ref<number | null>(null);
const hoverPx = ref(0); // pointer x in CSS px inside the wrapper
/** The moment hovered in the list (not via the ribbon): it gets the readout and a spotlight. */
const focusMoment = computed(() =>
  props.hoverId && hoverSec.value == null
    ? (props.moments.find((m) => m.id === props.hoverId) ?? null)
    : null,
);
/** Where the clip for a moment would land (mirrors clipStore.selectAround). */
const CLIP_BEFORE = 25;
const CLIP_AFTER = 20;
const readout = computed(() => {
  const sec = hoverSec.value ?? focusMoment.value?.t ?? null;
  if (sec == null) return null;
  const b = props.buckets[Math.floor(sec / bucketSec.value)];
  const t0 = b ? b.t : Math.floor(sec / 15) * 15;
  const chat = burst(props.messages, t0, t0 + bucketSec.value);
  // an AI pin (a transcript hit) leads with what the streamer said
  const ai =
    focusMoment.value?.source === 'ai'
      ? focusMoment.value
      : (props.moments.find((m) => m.source === 'ai' && Math.abs(m.t - sec) < 8) ?? null);
  return {
    ai,
    time: formatHms(sec),
    mult: b ? Math.pow(2, Math.max(0, b.rate)) : 1,
    users: b?.users ?? chat.users,
    lines: chat.lines,
    frame: props.storyboard ? frameAt(props.storyboard, sec) : null,
  };
});
const readoutLeft = computed(() => {
  const w = wrap.value?.clientWidth ?? 0;
  const px =
    focusMoment.value && wrap.value
      ? ((focusMoment.value.t - v0.value) / span.value) * wrap.value.clientWidth
      : hoverPx.value;
  const rw = readout.value?.frame ? 336 : 224;
  return Math.max(8, Math.min(w - rw - 8, px - rw / 2));
});

type Drag = 'in' | 'out' | 'brush' | 'mini' | null;
const dragging = ref<Drag>(null);
let brushStart = 0;
let brushed = false;
let pointerId = 0;
let downX = 0;

/**
 * Two fingers zoom and pan the ribbon (Angel, 2026-09-17: a phone had no way to zoom — the
 * wheel path is mouse and trackpad only). The pinch owns the gesture: the brush the first
 * finger started is abandoned, the second finger's span sets the zoom, and the content point
 * under the midpoint stays under it, so the same gesture pans. `touch-none` on the SVG keeps
 * the browser from zooming the page instead.
 */
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; span: number; sec: number } | null = null;
/** After a pinch, the finger left on the glass must not start brushing. */
let afterPinch = false;

function pinchPoints() {
  const [a, b] = [...touches.values()];
  return a && b ? { a, b, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) } : null;
}
/** Where the midpoint sits across the ribbon, 0…1. */
function pinchFrac(a: { x: number }, b: { x: number }): number {
  const r = svg.value?.getBoundingClientRect();
  if (!r?.width) return 0.5;
  return Math.max(0, Math.min(1, ((a.x + b.x) / 2 - r.left) / r.width));
}
function pinchStart() {
  const p = pinchPoints();
  if (!p) return;
  // drop whatever one finger had started
  dragging.value = null;
  hoverSec.value = null;
  if (svg.value?.hasPointerCapture(pointerId)) svg.value.releasePointerCapture(pointerId);
  pinch = {
    dist: p.dist,
    span: span.value,
    sec: v0.value + pinchFrac(p.a, p.b) * span.value,
  };
}
function pinchMove() {
  const p = pinchPoints();
  if (!pinch || !p) return;
  const newSpan = Math.max(60, Math.min(total.value, pinch.span * (pinch.dist / p.dist)));
  const start = pinch.sec - pinchFrac(p.a, p.b) * newSpan;
  setView(start, start + newSpan);
}

/**
 * Touch bookkeeping runs in the capture phase, before anything else sees the event: the
 * moment pins stop propagation on their own, so a finger landing on one would otherwise be
 * invisible here and the pinch would never start (or would start with one finger missing).
 */
function onTouchDown(e: PointerEvent) {
  if (e.pointerType !== 'touch') {
    afterPinch = false; // a mouse or pen press means the touch gesture is over
    return;
  }
  // the first finger of a gesture starts the bookkeeping clean: a `pointerup` that never
  // arrived (the finger left the glass, the page scrolled away) must not haunt the next one
  if (e.isPrimary) {
    touches.clear();
    pinch = null;
    afterPinch = false;
  }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) pinchStart();
}
function onTouchMove(e: PointerEvent) {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) pinchMove();
}
function onTouchUp(e: PointerEvent) {
  if (e.pointerType !== 'touch') return;
  touches.delete(e.pointerId);
  if (pinch) {
    pinch = null;
    dragging.value = null;
  } else if (!afterPinch) return;
  // stays shut until the next gesture's first finger: the fingers that end a pinch lift over
  // whatever is under them — a moment pin, usually — and that is not a tap (Angel, 2026-09-17)
  afterPinch = true;
}
/** True while two fingers own the ribbon, and until the last of them lifts. */
function gesturing(): boolean {
  return pinch !== null || afterPinch || touches.size > 1;
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (gesturing()) return;
  // a press near the In / Out line grabs the handle — measured on screen, with a wider
  // reach for fingers (2026-09-15: the old 12-unit zones were ~4 px on a phone)
  const r = svg.value?.getBoundingClientRect();
  if (r && r.width) {
    const grab = e.pointerType === 'touch' || e.pointerType === 'pen' ? 26 : 12;
    const px = e.clientX - r.left;
    const at = (sec: number | null | undefined) =>
      sec == null ? Infinity : Math.abs(((sec - v0.value) / span.value) * r.width - px);
    const dIn = at(props.inSec);
    const dOut = at(props.outSec);
    if (Math.min(dIn, dOut) <= grab) {
      const which = dIn <= dOut ? 'in' : 'out';
      // keep the finger's offset from the line so the handle doesn't jump under it
      grabOffset = (which === 'in' ? props.inSec! : props.outSec!) - secFromEvent(e);
      return startDrag(which, e);
    }
  }
  pointerId = e.pointerId;
  downX = e.clientX;
  brushStart = secFromEvent(e);
  brushed = false;
  dragging.value = 'brush';
  svg.value?.setPointerCapture(e.pointerId);
}
let grabOffset = 0; // seconds between the grabbed handle and the pointer at grab time
function onMove(e: PointerEvent) {
  if (gesturing()) return;
  const sec =
    dragging.value === 'in' || dragging.value === 'out'
      ? Math.max(0, Math.min(total.value, secFromEvent(e) + grabOffset))
      : secFromEvent(e);
  const r = wrap.value?.getBoundingClientRect();
  hoverSec.value = sec;
  hoverPx.value = r ? e.clientX - r.left : 0;
  // a range dragged shut (narrower than CLOSE_PX on screen) goes away entirely
  const CLOSE_PX = 6;
  const closeSec = CLOSE_PX * (span.value / (svg.value?.getBoundingClientRect().width || W));
  if (dragging.value === 'in' || dragging.value === 'out') {
    // a handle only starts to move after 4 px, so a tap on it stays a tap (a seek)
    if (!handleMoved && Math.abs(e.clientX - downX) < 4) return;
    handleMoved = true;
  }
  if (dragging.value === 'in') {
    if (props.outSec != null && sec >= props.outSec - closeSec) return closeRange();
    emit('update:in', sec);
  } else if (dragging.value === 'out') {
    if (props.inSec != null && sec <= props.inSec + closeSec) return closeRange();
    emit('update:out', sec);
  } else if (dragging.value === 'brush') {
    if (!brushed && Math.abs(e.clientX - downX) < 4) return;
    brushed = true;
    const a = Math.min(brushStart, sec);
    const b = Math.max(brushStart, sec);
    if (b - a >= closeSec) {
      emit('update:in', a);
      emit('update:out', b);
    } else if (props.inSec != null) {
      emit('clear-range');
    }
  }
}
function closeRange() {
  emit('clear-range');
  dragging.value = null;
  if (svg.value?.hasPointerCapture(pointerId)) svg.value.releasePointerCapture(pointerId);
}
function onUp(e: PointerEvent) {
  if (gesturing()) return;
  const was = dragging.value;
  if (was === 'brush' && !brushed) {
    const sec = Math.floor(secFromEvent(e));
    emit('seek', sec);
    pulse(sec);
  } else if ((was === 'in' || was === 'out') && !handleMoved) {
    // a tap on a handle: play from exactly there (Angel, 2026-09-15)
    const sec = was === 'in' ? props.inSec : props.outSec;
    if (sec != null) {
      emit('seek', sec);
      pulse(sec);
    }
  }
  // clear on the next tick so the click that ends a handle drag doesn't seek
  setTimeout(() => (dragging.value = null), 0);
  if (svg.value?.hasPointerCapture(pointerId)) svg.value.releasePointerCapture(pointerId);
}
function onLeave() {
  hoverSec.value = null;
}
let handleMoved = false;
function startDrag(which: 'in' | 'out', e: PointerEvent) {
  dragging.value = which;
  pointerId = e.pointerId;
  downX = e.clientX;
  handleMoved = false;
  svg.value?.setPointerCapture(e.pointerId);
  e.stopPropagation();
}

// --- wheel: zoom around the pointer; shift / horizontal wheel pans ---
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const sec = secFromEvent(e);
  const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (horizontal) {
    const d = (e.shiftKey ? e.deltaY : e.deltaX) * (span.value / W) * 0.6;
    setView(v0.value + d, v1.value + d);
    return;
  }
  const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
  const newSpan = Math.max(60, Math.min(total.value, span.value * factor));
  const start = sec - (sec - v0.value) * (newSpan / span.value);
  setView(start, start + newSpan);
}
function setView(start: number, end: number) {
  const s = Math.max(1, end - start);
  const full = s >= total.value - 1;
  const st = full ? 0 : Math.max(0, Math.min(total.value - s, start));
  const en = full ? total.value : st + s;
  // the user is steering: show it now (the watcher then finds nothing left to glide to)
  cancelAnimationFrame(anim);
  shown.value = { start: st, end: en };
  emit('update:view', full ? null : { start: st, end: en });
}
// minimap: click / drag moves the window
const mini = ref<SVGSVGElement | null>(null);
function miniSec(e: PointerEvent): number {
  const el = mini.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * total.value;
}
function miniDown(e: PointerEvent) {
  dragging.value = 'mini';
  mini.value?.setPointerCapture(e.pointerId);
  miniMove(e);
}
function miniMove(e: PointerEvent) {
  if (dragging.value !== 'mini') return;
  const c = miniSec(e);
  setView(c - span.value / 2, c + span.value / 2);
}
function miniUp() {
  setTimeout(() => (dragging.value = null), 0);
}

// --- pins ---
function pinEnter(m: Moment) {
  emit('hover-moment', m.id);
}
function pinLeave() {
  emit('hover-moment', null);
}
function pinClick(m: Moment, e: Event) {
  e.stopPropagation();
  // a finger of a pinch happened to lift over this pin: that is a zoom, not a pick
  if (gesturing()) return;
  emit('select', m);
  pulse(m.t);
}

// --- the pulse: a light band spreading both ways from a seek ---
const pulseAt = ref<{ sec: number; key: number } | null>(null);
function pulse(sec: number) {
  pulseAt.value = { sec, key: Date.now() };
}
</script>

<template>
  <div ref="wrap" class="relative w-full select-none">
    <div class="relative h-44 w-full overflow-hidden rounded-2xl">
      <svg
        ref="svg"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        class="hl-timeline absolute inset-0 block h-full w-full cursor-crosshair touch-none"
        @pointerdown.capture="onTouchDown"
        @pointermove.capture="onTouchMove"
        @pointerup.capture="onTouchUp"
        @pointercancel.capture="onTouchUp"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerleave="onLeave"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel="onWheel"
      >
        <defs>
          <linearGradient :id="gid" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#ffa968" />
            <stop offset="0.2" stop-color="#ff77b5" />
            <stop offset="0.35" stop-color="#ae81ff" />
            <stop offset="0.5" stop-color="#8eb0ff" />
            <stop offset="0.62" stop-color="#ff77b5" />
            <stop offset="0.78" stop-color="#ffa968" />
            <stop offset="0.92" stop-color="#ffde68" />
            <stop offset="1" stop-color="#ae81ff" />
          </linearGradient>
          <!-- the transcription scan: a soft accent light sweeping across the chunk -->
          <linearGradient :id="gid + 'scan'" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="var(--color-accent)" stop-opacity="0" />
            <stop offset="0.5" stop-color="var(--color-accent)" stop-opacity="0.28">
              <animate attributeName="offset" values="0;1;0" dur="2.4s" repeatCount="indefinite" />
            </stop>
            <stop offset="1" stop-color="var(--color-accent)" stop-opacity="0" />
          </linearGradient>
          <filter :id="gid + 'b'" x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <pattern :id="gid + 's'" width="4" height="2.4" patternUnits="userSpaceOnUse">
            <rect width="4" height="0.8" fill="rgba(255,255,255,0.18)" />
          </pattern>
          <!-- loading: the covered stretches, each with a soft leading edge -->
          <linearGradient :id="gid + 'e'" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#fff" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask :id="gid + 'c'" maskUnits="userSpaceOnUse" x="0" y="0" :width="W" :height="H">
            <template v-for="(c, i) in covered" :key="i">
              <rect
                :x="c.x0"
                y="0"
                :width="c.done ? c.x1 - c.x0 : Math.max(0, c.x1 - c.x0 - 22)"
                :height="H"
                fill="#fff"
              />
              <rect
                v-if="!c.done"
                :x="Math.max(c.x0, c.x1 - 22)"
                y="0"
                :width="Math.min(22, c.x1 - c.x0)"
                :height="H"
                :fill="`url(#${gid}e)`"
              />
            </template>
          </mask>
          <linearGradient :id="gid + 'g'" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style="stop-color: var(--glow)" stop-opacity="0" />
            <stop offset="0.5" style="stop-color: var(--glow)" stop-opacity="0.55" />
            <stop offset="1" style="stop-color: var(--glow)" stop-opacity="0" />
          </linearGradient>
          <linearGradient :id="gid + 'p'" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" style="stop-color: var(--glow)" stop-opacity="0" />
            <stop offset="0.5" style="stop-color: var(--glow)" stop-opacity="0.85" />
            <stop offset="1" style="stop-color: var(--glow)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <!-- the ribbon: a soft halo, the fill, a whisper of horizontal threads. While loading,
             only the covered stretches are drawn in full; the rest is a ghost. -->
        <path v-if="isLoading" :d="ribbon" :fill="`url(#${gid})`" opacity="0.14" />
        <g
          :mask="isLoading ? `url(#${gid}c)` : undefined"
          :class="{ 'thread-muted': emoOn }"
          :opacity="emoOn ? 0.13 : 1"
        >
          <path :d="ribbon" :fill="`url(#${gid})`" opacity="0.5" :filter="`url(#${gid}b)`" />
          <path :d="ribbon" :fill="`url(#${gid})`" opacity="0.92" />
          <path :d="ribbon" :fill="`url(#${gid}s)`" opacity="0.7" />
        </g>
        <!-- the mood layer (ADR-43) wearing the thread's own clothes: halo, fill, sheen, the
             same silk. It replaces the thread rather than sitting on a different chart on top
             of it — the hype ribbon stays underneath as a ghost, for where you are. The shape
             is what changed: the top edge is one pole, the bottom edge the other, so the
             asymmetry about the spine is the reading. -->
        <g v-if="emoOn" class="emo" data-testid="emo-ribbon" pointer-events="none">
          <path :d="emoRibbon" :fill="`url(#${gid})`" opacity="0.5" :filter="`url(#${gid}b)`" />
          <path :d="emoRibbon" :fill="`url(#${gid})`" opacity="0.92" />
          <path :d="emoRibbon" :fill="`url(#${gid}s)`" opacity="0.7" />
          <line
            x1="0"
            :y1="H / 2"
            :x2="W"
            :y2="H / 2"
            class="emo-spine"
            vector-effect="non-scaling-stroke"
          />
        </g>
        <!-- lane fronts: a hairline in ink with a small dot riding the spine (same language as
             the pins), instead of a light -->
        <g v-if="isLoading" pointer-events="none">
          <template v-for="(hx, i) in heads" :key="'h' + i">
            <line
              :x1="hx"
              :x2="hx"
              y1="0"
              :y2="H"
              style="stroke: var(--color-ink)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              opacity="0.35"
            />
            <ellipse
              class="front"
              :cx="hx"
              :cy="H / 2"
              :rx="2.6 * sx"
              :ry="2.6 * sy"
              style="fill: var(--color-ink)"
              :style="{ transformOrigin: `${hx}px ${H / 2}px` }"
            />
          </template>
        </g>
        <!-- seek pulse -->
        <g
          v-if="pulseAt && pulseAt.sec >= v0 && pulseAt.sec <= v1"
          :key="pulseAt.key"
          pointer-events="none"
        >
          <rect
            class="pulse"
            :x="x(pulseAt.sec) - 1"
            y="0"
            width="2"
            :height="H"
            :fill="`url(#${gid}p)`"
            :style="{ transformOrigin: `${x(pulseAt.sec)}px ${H / 2}px` }"
          />
        </g>
        <line
          x1="0"
          :x2="W"
          :y1="H / 2"
          :y2="H / 2"
          style="stroke: var(--color-ink)"
          stroke-width="1.4"
          vector-effect="non-scaling-stroke"
          opacity="0.9"
          pointer-events="none"
        />
        <!-- clip marks: ink brackets along the bottom; thumbnails as tiny frames -->
        <g v-for="(c, i) in clips" :key="'c' + i" pointer-events="none">
          <template v-if="c.outSec >= v0 && c.inSec <= v1">
            <line
              :x1="x(c.inSec)"
              :x2="x(c.outSec)"
              :y1="H - 11"
              :y2="H - 11"
              style="stroke: var(--color-ink)"
              stroke-width="1.2"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(c.inSec)"
              :x2="x(c.inSec)"
              :y1="H - 14"
              :y2="H - 8"
              style="stroke: var(--color-ink)"
              stroke-width="1.2"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(c.outSec)"
              :x2="x(c.outSec)"
              :y1="H - 14"
              :y2="H - 8"
              style="stroke: var(--color-ink)"
              stroke-width="1.2"
              vector-effect="non-scaling-stroke"
            />
          </template>
        </g>
        <g v-for="(th, i) in thumbs" :key="'t' + i" pointer-events="none">
          <rect
            v-if="th >= v0 && th <= v1"
            :x="x(th) - 4"
            :y="H - 21"
            width="8"
            height="6"
            style="fill: var(--color-ground); stroke: var(--color-ink)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </g>
        <!-- spotlight: the moment hovered in the list — its clip window glows on the ribbon and
             a ring leaves its pin -->
        <g
          v-if="focusMoment && focusMoment.t >= v0 && focusMoment.t <= v1"
          :key="'spot' + focusMoment.id"
          pointer-events="none"
        >
          <rect
            class="spot"
            :x="x(Math.max(v0, focusMoment.t - CLIP_BEFORE))"
            y="0"
            :width="
              Math.max(
                2,
                x(Math.min(v1, focusMoment.t + CLIP_AFTER)) -
                  x(Math.max(v0, focusMoment.t - CLIP_BEFORE)),
              )
            "
            :height="H"
            :fill="`url(#${gid}g)`"
          />
          <ellipse
            class="ring"
            :cx="x(focusMoment.t) + barW / 2"
            :cy="pinDot(focusMoment)"
            :rx="5 * sx"
            :ry="5 * sy"
            fill="none"
            style="stroke: var(--color-ink)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
            :style="{
              transformOrigin: `${x(focusMoment.t) + barW / 2}px ${pinDot(focusMoment)}px`,
            }"
          />
        </g>
        <!-- moment pins: a hairline from the spine up through the peak to an ink dot just above it -->
        <g
          v-for="m in visibleMoments"
          :key="m.id"
          class="cursor-pointer"
          :class="{ 'is-hot': m.id === hoverId || m.id === activeId }"
          @pointerenter="pinEnter(m)"
          @pointerleave="pinLeave"
          @pointerdown.stop
          @pointerup.stop="pinClick(m, $event)"
        >
          <!-- hit area: 28 px wide on screen, from above the dot down to the spine -->
          <rect
            :x="x(m.t) + barW / 2 - 14 * sx"
            :y="pinRect(m).y"
            :width="28 * sx"
            :height="pinRect(m).height"
            fill="transparent"
          />
          <!-- AI pins (transcript hits the user asked for): accent, dashed stem, hollow dot -->
          <line
            :x1="x(m.t) + barW / 2"
            :x2="x(m.t) + barW / 2"
            :y1="H / 2"
            :y2="pinTop(m)"
            :style="{
              stroke: m.source === 'ai' ? 'var(--color-accent)' : 'var(--color-ink)',
              transformOrigin: `${x(m.t) + barW / 2}px ${H / 2}px`,
            }"
            stroke-width="1"
            :stroke-dasharray="m.source === 'ai' ? '3 3' : undefined"
            vector-effect="non-scaling-stroke"
            class="pin-stem pin-in"
          />
          <ellipse
            :cx="x(m.t) + barW / 2"
            :cy="pinDot(m)"
            :rx="(m.id === hoverId || m.id === activeId ? 4.5 : 3) * sx"
            :ry="(m.id === hoverId || m.id === activeId ? 4.5 : 3) * sy"
            :style="
              m.source === 'ai'
                ? {
                    fill: 'var(--color-ground)',
                    stroke: 'var(--color-accent)',
                    strokeWidth: 1.6,
                    transformOrigin: `${x(m.t) + barW / 2}px ${pinTop(m) - 2}px`,
                  }
                : {
                    fill: 'var(--color-ink)',
                    transformOrigin: `${x(m.t) + barW / 2}px ${pinTop(m) - 2}px`,
                  }
            "
            vector-effect="non-scaling-stroke"
            class="pin-dot pin-in-dot"
          />
        </g>
        <line
          v-for="tk in ticks"
          :key="tk"
          :x1="x(tk)"
          :x2="x(tk)"
          :y1="H - 6"
          :y2="H"
          style="stroke: var(--color-muted)"
          opacity="0.6"
          pointer-events="none"
        />

        <!-- transcript: what the AI can search (accent band under the ribbon) and, while a
             whole-VOD transcription runs, its target range and a scanning light on the chunk
             being worked on -->
        <g v-if="transcript" pointer-events="none">
          <template v-if="transcribing">
            <rect
              :x="x(Math.max(v0, transcribing.fromSec))"
              :y="H - 11 * sy"
              :width="
                Math.max(
                  0,
                  x(Math.min(v1, transcribing.toSec)) - x(Math.max(v0, transcribing.fromSec)),
                )
              "
              :height="2 * sy"
              style="fill: var(--color-accent)"
              opacity="0.22"
            />
            <g v-if="transcribing.current">
              <rect
                :x="x(transcribing.current[0])"
                y="0"
                :width="Math.max(2 * sx, x(transcribing.current[1]) - x(transcribing.current[0]))"
                :height="H"
                :fill="`url(#${gid}scan)`"
                class="scan"
              />
              <rect
                :x="x(transcribing.current[0])"
                :y="H - 11 * sy"
                :width="Math.max(2 * sx, x(transcribing.current[1]) - x(transcribing.current[0]))"
                :height="2 * sy"
                style="fill: var(--color-accent)"
                class="scan-band"
              />
            </g>
          </template>
          <rect
            v-for="r in transcribed"
            :key="r.a"
            :x="x(Math.max(v0, r.a))"
            :y="H - 11 * sy"
            :width="Math.max(1 * sx, x(Math.min(v1, r.b)) - x(Math.max(v0, r.a)))"
            :height="2 * sy"
            style="fill: var(--color-accent)"
            opacity="0.85"
          />
        </g>

        <!-- in/out range -->
        <g v-if="hasRange">
          <!-- the fill stops where the feet are, so the selection is a closed shape between
               two capped stems rather than a band cutting the whole ribbon (Angel, 2026-09-18) -->
          <rect
            :x="x(inSec!)"
            :y="4 * sy"
            :width="Math.max(1, x(outSec!) - x(inSec!))"
            :height="H - 8 * sy"
            style="fill: var(--color-ink)"
            opacity="0.07"
            pointer-events="none"
          />
          <!-- the handles wear the mark's serif feet (Angel, 2026-09-18): a capped stem reads
               as a clip edge — a deliberate end — where a line running into the ribbon's top
               and bottom read as a cut through it. Lengths are in screen px (× sx / sy) so the
               feet stay square under the ribbon's non-uniform scaling. -->
          <g
            v-for="(s, i) in [inSec!, outSec!]"
            :key="i"
            style="stroke: var(--color-ink)"
            stroke-linecap="round"
            stroke-width="1.5"
            pointer-events="none"
          >
            <!-- vector-effect is not an inherited property: it goes on every line, not the g -->
            <line
              :x1="x(s)"
              :x2="x(s)"
              :y1="4 * sy"
              :y2="H - 4 * sy"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(s) - 7 * sx"
              :x2="x(s) + 7 * sx"
              :y1="4 * sy"
              :y2="4 * sy"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(s) - 7 * sx"
              :x2="x(s) + 7 * sx"
              :y1="H - 4 * sy"
              :y2="H - 4 * sy"
              vector-effect="non-scaling-stroke"
            />
          </g>
          <!-- grab zones (12 px each side on screen): only for the resize cursor — the press
               itself is resolved in onDown, which picks the nearer handle -->
          <rect
            :x="x(inSec!) - 12 * sx"
            y="0"
            :width="24 * sx"
            :height="H"
            fill="transparent"
            class="cursor-ew-resize"
          />
          <rect
            :x="x(outSec!) - 12 * sx"
            y="0"
            :width="24 * sx"
            :height="H"
            fill="transparent"
            class="cursor-ew-resize"
          />
        </g>

        <!-- live edge: the VOD ends here and keeps coming (clamped to the drawn length, which
             is whole seconds behind the fractional edge — the marker must never blink) -->
        <g v-if="edgeSec != null" pointer-events="none">
          <g
            style="stroke: var(--color-danger)"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.7"
          >
            <line
              :x1="x(edgeSec)"
              :x2="x(edgeSec)"
              :y1="4 * sy"
              :y2="H - 4 * sy"
              stroke-dasharray="4 4"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(edgeSec) - 7 * sx"
              :x2="x(edgeSec) + 7 * sx"
              :y1="4 * sy"
              :y2="4 * sy"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="x(edgeSec) - 7 * sx"
              :x2="x(edgeSec) + 7 * sx"
              :y1="H - 4 * sy"
              :y2="H - 4 * sy"
              vector-effect="non-scaling-stroke"
            />
          </g>
          <ellipse
            :cx="x(edgeSec)"
            :cy="H / 2"
            :rx="5 * sx"
            :ry="5 * sy"
            style="fill: var(--color-danger)"
            class="live-edge"
            :style="{ transformOrigin: `${x(edgeSec)}px ${H / 2}px` }"
          />
        </g>
        <!-- the playhead wears the feet too (Angel, 2026-09-18): every vertical on the ribbon
             now ends deliberately instead of running off its top and bottom -->
        <g
          v-if="currentTime >= v0 && currentTime <= v1"
          style="stroke: var(--color-playhead)"
          stroke-width="2"
          stroke-linecap="round"
          pointer-events="none"
        >
          <line
            :x1="x(currentTime)"
            :x2="x(currentTime)"
            :y1="4 * sy"
            :y2="H - 4 * sy"
            vector-effect="non-scaling-stroke"
          />
          <line
            :x1="x(currentTime) - 7 * sx"
            :x2="x(currentTime) + 7 * sx"
            :y1="4 * sy"
            :y2="4 * sy"
            vector-effect="non-scaling-stroke"
          />
          <line
            :x1="x(currentTime) - 7 * sx"
            :x2="x(currentTime) + 7 * sx"
            :y1="H - 4 * sy"
            :y2="H - 4 * sy"
            vector-effect="non-scaling-stroke"
          />
        </g>
      </svg>
      <!-- LIVE pill at the edge: HTML, so the letters are not stretched by the ribbon's scaling -->
      <!-- the poles, named. The colours are validated for colour-vision deficiency, but a
           chart that needs colour to say which lobe is which is a chart half the readers
           cannot use, so the names sit on it. Text, not SVG: the SVG is stretched. -->
      <template v-if="emoLabels">
        <div class="emo-label pointer-events-none absolute top-1.5 left-2.5" data-testid="emo-up">
          {{ emoLabels.up }}
        </div>
        <div class="emo-label emo-label-down pointer-events-none absolute bottom-1.5 left-2.5" data-testid="emo-down">
          {{ emoLabels.down }}
        </div>
      </template>
      <div
        v-if="edgeSec != null"
        class="live-pill pointer-events-none absolute top-2 font-mono text-[10px] font-bold tracking-[0.12em]"
        :style="{ left: `${edgePx}px` }"
        aria-hidden="true"
      >
        <span class="live-pill-dot"></span>{{ t('timeline.live') }}
      </div>
    </div>
    <!-- hover readout: below the spine so the pins stay visible, and short enough to stay
         inside the ribbon box (the panels below would paint over it): the storyboard frame,
         when there is one, sits beside the text rather than above it -->
    <div
      v-if="readout && dragging !== 'in' && dragging !== 'out'"
      class="glass-sm pointer-events-none absolute top-[92px] z-20 flex gap-2.5 px-3 py-1.5 text-xs"
      :class="readout.frame ? 'w-[336px]' : 'w-56'"
      :style="{ left: readoutLeft + 'px' }"
    >
      <div
        v-if="readout.frame"
        class="w-[104px] shrink-0 self-start overflow-hidden rounded-md bg-black/80"
        :style="{ aspectRatio: `${readout.frame.width} / ${readout.frame.height}` }"
      >
        <div
          class="h-full w-full"
          :style="{
            backgroundImage: `url(${readout.frame.url})`,
            backgroundPosition: `-${readout.frame.x}px -${readout.frame.y}px`,
            backgroundSize: 'auto',
            transform: `scale(${104 / readout.frame.width})`,
            transformOrigin: '0 0',
            width: readout.frame.width + 'px',
            height: readout.frame.height + 'px',
          }"
        ></div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between font-mono text-[11px]">
          <span class="text-ink font-medium">{{ readout.time }}</span>
          <span class="text-muted"
            >{{ readout.mult.toFixed(1) }}× ·
            {{ t('timeline.chatters', { n: readout.users }) }}</span
          >
        </div>
        <div v-if="readout.ai" class="mt-1 text-[11px] leading-snug">
          <span class="text-accent font-mono font-bold">AI</span>
          <span class="text-ink-2"> {{ t('timeline.quote', { quote: readout.ai.quote }) }}</span>
        </div>
        <ul v-if="readout.lines.length" class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="l in readout.lines"
            :key="l.text"
            class="flex justify-between gap-2 font-mono text-[11px]"
          >
            <span class="text-ink-2 truncate">{{ l.text }}</span>
            <span class="text-muted shrink-0">×{{ l.count }}</span>
          </li>
        </ul>
        <div v-else-if="!readout.ai" class="text-muted mt-1 text-[11px]">
          {{ t('timeline.quiet') }}
        </div>
      </div>
    </div>

    <!-- minimap: the whole VOD with the visible window; drag to move it -->
    <div v-if="zoomed" class="relative mt-1 h-9 w-full overflow-hidden rounded-xl">
      <svg
        ref="mini"
        :viewBox="`0 0 ${W} ${MH}`"
        preserveAspectRatio="none"
        class="hl-timeline absolute inset-0 block h-full w-full cursor-grab touch-none"
        :class="{ 'cursor-grabbing': dragging === 'mini' }"
        @pointerdown="miniDown"
        @pointermove="miniMove"
        @pointerup="miniUp"
        @pointercancel="miniUp"
      >
        <path :d="miniRibbon" :fill="`url(#${gid})`" opacity="0.8" />
        <line
          x1="0"
          :x2="W"
          :y1="MH / 2"
          :y2="MH / 2"
          style="stroke: var(--color-ink)"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
          opacity="0.7"
        />
        <rect
          :x="xm(v0)"
          y="0"
          :width="Math.max(2, xm(v1) - xm(v0))"
          :height="MH"
          style="
            fill: color-mix(in srgb, var(--color-lift) 45%, transparent);
            stroke: var(--color-ink);
          "
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="currentTime <= total"
          :x1="xm(currentTime)"
          :x2="xm(currentTime)"
          y1="0"
          :y2="MH"
          style="stroke: var(--color-playhead)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>

    <div class="text-muted mt-1 flex justify-between font-mono text-[11px]">
      <span>{{ formatHms(v0) }}</span>
      <span v-if="zoomed" class="text-muted">
        {{ t('timeline.zoomed') }} ·
        <span class="max-sm:hidden">{{ t('timeline.zoomPanHint') }} · </span>
        <button class="underline" @click="emit('update:view', null)">
          {{ t('timeline.wholeVod') }}
        </button>
      </span>
      <span v-else
        >{{ t('timeline.dragToSelect')
        }}<span class="max-sm:hidden"> · {{ t('timeline.scrollToZoom') }}</span></span
      >
      <span>{{ formatHms(v1) }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * The emotion poles. Two hues from the thread's own ends, stepped until each cleared a
 * six-check validation against its own ground — CVD ΔE ≈ 26 (protan and tritan), contrast
 * above 3:1 in both themes. Night is a separate choice rather than a flip of day.
 */
.emo {
  --emo-up: #c2661a;
  --emo-down: #5a6fd6;
}
:global(html[data-theme='dark']) .emo {
  --emo-up: #cf7020;
  --emo-down: #6b7fe0;
}
/*
 * While the mood layer is on, the thread gives up its colour as well as its weight. Two
 * colour encodings over one strip is one too many: with the thread still in silk, its lower
 * half reads as the lower pole, which is exactly the misreading the labels are there to
 * prevent. Greyed, it goes back to being context.
 */
.thread-muted {
  filter: grayscale(1);
}
.emo-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  color: #c2661a;
  z-index: 10;
}
.emo-label-down {
  color: #5a6fd6;
}
:global(html[data-theme='dark']) .emo-label {
  color: #cf7020;
}
:global(html[data-theme='dark']) .emo-label-down {
  color: #6b7fe0;
}
.emo-spine {
  stroke: var(--color-ink);
  stroke-width: 1;
  opacity: 0.28;
}

.pin-dot,
.pin-stem {
  transition:
    rx 0.15s,
    ry 0.15s,
    stroke-width 0.15s;
}
.is-hot .pin-stem {
  stroke-width: 1.8;
}
.pulse {
  animation: pulse-out 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
}
/* the live edge beats like the loading fronts; the pill hangs left of the edge line */
.live-edge {
  animation: front-beat 1.4s ease-in-out infinite;
}
.live-pill {
  transform: translateX(calc(-100% - 6px));
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 8px;
  border-radius: 999px;
  color: #fff;
  background: var(--color-danger);
  box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--color-danger) 70%, transparent);
  /* a two-word label ("EN VIVO", "생방송 중") must stay on one line: wrapping made the pill
     two rows tall and squashed the dot into an oval (Angel, 2026-09-17) */
  white-space: nowrap;
}
.live-pill-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #fff;
  animation: pill-blink 1.4s ease-in-out infinite;
}
@keyframes pill-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
/* transcribing: the band segment under the chunk being worked on breathes */
.scan-band {
  animation: scan-beat 1.2s ease-in-out infinite;
}
@keyframes scan-beat {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
/* loading: lane-front dots beat; new pins grow up from the spine */
.front {
  animation: front-beat 1.2s ease-in-out infinite;
}
@keyframes front-beat {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.7);
  }
}
.pin-in {
  animation: pin-grow 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.pin-in-dot {
  animation: dot-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both;
}
@keyframes pin-grow {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}
@keyframes dot-pop {
  from {
    transform: scale(0);
  }
  to {
    transform: scale(1);
  }
}
.spot {
  animation: spot-in 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes spot-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.ring {
  animation: ring-out 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes ring-out {
  from {
    transform: scale(1);
    opacity: 0.8;
  }
  to {
    transform: scale(5);
    opacity: 0;
  }
}
@keyframes pulse-out {
  from {
    transform: scaleX(1);
    opacity: 0.9;
  }
  to {
    transform: scaleX(160);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-edge,
  .live-pill-dot {
    animation: none;
  }
  .scan-band {
    animation: none;
    opacity: 0.8;
  }
  .pulse,
  .ring,
  .front,
  .pin-in,
  .pin-in-dot {
    animation: none;
  }
  .spot {
    animation-duration: 0.01s;
  }
}
</style>
