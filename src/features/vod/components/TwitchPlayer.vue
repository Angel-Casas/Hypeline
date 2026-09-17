<script setup lang="ts">
/**
 * Official Twitch embed (player.twitch.tv/js/embed/v1.js). ToS-clean, no CORS.
 * `parent` must be "localhost" or a real hostname (file:// and 127.0.0.1 are rejected).
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * `live`: the VOD is still recording. The embed learns the VOD's length once, when it loads,
 * so anything recorded after that is unreachable until it is created again (ADR-18, Angel
 * 2026-09-16: moments past the join point would not play until a refresh). In live mode a
 * seek past the loaded end — or playback reaching it — recreates the embed at that second.
 */
const props = defineProps<{
  vodId: string;
  seekTarget: number | null;
  live?: boolean;
  /** The VOD's length as known when the embed loads — what the embed will be able to reach. */
  lengthSeconds?: number;
}>();
const emit = defineEmits<{ time: [sec: number]; ready: [] }>();

// Minimal typing of the embed API surface we use.
interface TwitchPlayerApi {
  seek(sec: number): void;
  getDuration?: () => number;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  addEventListener(event: string, cb: () => void): void;
  destroy?: () => void;
}
interface TwitchEmbed {
  Player: {
    new (el: string | HTMLElement, opts: Record<string, unknown>): TwitchPlayerApi;
    READY: string;
    PLAYING: string;
    PAUSE: string;
  };
}
declare global {
  interface Window {
    Twitch?: TwitchEmbed;
  }
}

const host = ref<HTMLDivElement | null>(null);
let player: TwitchPlayerApi | null = null;
let timer: number | null = null;
let raf = 0;
const ready = ref(false);
const playing = ref(false);
const pendingSeek = ref<number | null>(null);
/** How much of the VOD the current embed knows about (its duration when it loaded). */
let loadedEnd = Infinity;
/** The VOD length known when the embed was created (live mode may switch on after that). */
let createdLength = 0;
let reloading = false;

/**
 * The clock we report. The embed's getCurrentTime() only ticks every ~500 ms and, after a
 * seek while paused, keeps answering the old position until playback starts — so the playhead
 * jumped and stuck. We keep our own clock: a seek sets it at once; while playing it runs
 * between polls (extrapolated from the last polled time); a poll that disagrees only
 * gently corrects it, unless it's far off (a seek made in the player itself), then we snap.
 */
let base = 0; // last known player time
let baseAt = 0; // performance.now() when `base` was taken
let lastPolled = -1;
let seekHold: number | null = null; // where we seeked; ignore stale polls until the player follows
let lastEmit = -1;

function clock(): number {
  return playing.value ? base + (performance.now() - baseAt) / 1000 : base;
}
function setClock(sec: number) {
  base = Math.max(0, sec);
  baseAt = performance.now();
}
function poll() {
  if (!player || !ready.value) return;
  const t = player.getCurrentTime();
  if (!Number.isFinite(t)) return;
  const prev = lastPolled;
  const moved = t !== prev;
  lastPolled = t;
  if (seekHold != null) {
    // stale until the player reports a time near the target, or its clock visibly moves on
    // (playing, or a jump: the user scrubbed inside the player itself)
    if (Math.abs(t - seekHold) < 3 || (moved && (playing.value || Math.abs(t - prev) > 2)))
      seekHold = null;
    else return;
  }
  const now = clock();
  if (Math.abs(t - now) > 1.5) setClock(t);
  else if (moved) setClock(now + (t - now) * 0.35);
  // live: the embed stops at the end it knows; carry on from there with a fresh one
  if (props.live && playing.value && loadedEnd !== Infinity && t >= loadedEnd - 1.5)
    reloadAt(loadedEnd);
}
function tick() {
  raf = requestAnimationFrame(tick);
  const t = clock();
  // ~30 Hz is plenty for a 1 px playhead and keeps the timeline's re-render cheap
  if (Math.abs(t - lastEmit) >= 1 / 30) {
    lastEmit = t;
    emit('time', t);
  }
}

function loadScript(): Promise<TwitchEmbed> {
  if (window.Twitch) return Promise.resolve(window.Twitch);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://player.twitch.tv/js/embed/v1.js';
    s.onload = () =>
      window.Twitch ? resolve(window.Twitch) : reject(new Error('Twitch embed missing'));
    s.onerror = () => reject(new Error('Could not load Twitch embed script'));
    document.head.appendChild(s);
  });
}

function parentHost(): string {
  const h = location.hostname;
  return h && h !== '127.0.0.1' ? h : 'localhost';
}

function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}
async function create(startAt?: number) {
  if (!host.value) return;
  const Twitch = await loadScript();
  player?.destroy?.();
  host.value.innerHTML = '';
  ready.value = false;
  playing.value = false;
  seekHold = null;
  lastPolled = -1;
  // what this embed will know of the VOD: the length at creation (READY refines it if it can)
  createdLength = props.lengthSeconds ?? 0;
  loadedEnd = props.live && createdLength ? createdLength : Infinity;
  setClock(startAt ?? 0);
  player = new Twitch.Player(host.value, {
    video: props.vodId,
    width: '100%',
    height: '100%',
    autoplay: startAt != null,
    muted: false,
    parent: [parentHost()],
    ...(startAt != null ? { time: hms(startAt) } : {}),
  });
  player.addEventListener(Twitch.Player.PLAYING, () => {
    setClock(clock());
    playing.value = true;
  });
  player.addEventListener(Twitch.Player.PAUSE, () => {
    setClock(clock());
    playing.value = false;
  });
  player.addEventListener(Twitch.Player.READY, () => {
    ready.value = true;
    reloading = false;
    const d = player?.getDuration?.();
    if (props.live && Number.isFinite(d) && d! > 0) loadedEnd = d!;
    emit('ready');
    if (pendingSeek.value != null) {
      doSeek(pendingSeek.value);
      pendingSeek.value = null;
    }
  });
  if (timer) clearInterval(timer);
  timer = window.setInterval(poll, 250);
  if (!raf) raf = requestAnimationFrame(tick);
}

/** Live and past what this embed has: load it again at that second (plays from there). */
function reloadAt(sec: number): boolean {
  if (!props.live || reloading || sec <= loadedEnd - 2) return false;
  reloading = true;
  void create(sec);
  return true;
}
function doSeek(sec: number) {
  if (reloadAt(sec)) return;
  if (!player || !ready.value) {
    pendingSeek.value = sec;
    setClock(sec);
    return;
  }
  seekHold = sec;
  setClock(sec);
  player.seek(sec);
  player.play();
}

function togglePlay() {
  if (!player || !ready.value) return;
  if (playing.value) player.pause();
  else player.play();
}
/** Seek without forcing playback (used by keyboard nudges). */
function seekQuiet(sec: number) {
  if (reloadAt(sec)) return;
  if (!player || !ready.value) return;
  seekHold = Math.max(0, sec);
  setClock(sec);
  player.seek(Math.max(0, sec));
}
defineExpose({ togglePlay, seekQuiet });

/**
 * Keyboard: the embed is a cross-origin iframe, so once it has focus (after a click on it)
 * our shortcuts never see the keys and the player's own bindings (space, arrows, m, f…) take
 * over — sometimes ours worked, sometimes Twitch's. We give focus straight back to the page
 * whenever the iframe takes it, so the keys always reach our shortcuts (Angel, 2026-09-15).
 */
function onWindowBlur() {
  setTimeout(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.tagName === 'IFRAME' && host.value?.contains(a)) a.blur();
  }, 0);
}
onMounted(() => {
  window.addEventListener('blur', onWindowBlur);
  void create();
});
watch(
  () => props.vodId,
  () => void create(),
);
// live mode usually switches on after the embed was created: bound it by that length
watch(
  () => props.live,
  (l) => {
    if (l && loadedEnd === Infinity && createdLength) loadedEnd = createdLength;
    if (!l) loadedEnd = Infinity;
  },
);
watch(
  () => props.seekTarget,
  (t) => {
    if (t != null) doSeek(t);
  },
);
onBeforeUnmount(() => {
  window.removeEventListener('blur', onWindowBlur);
  if (timer) clearInterval(timer);
  cancelAnimationFrame(raf);
  player?.destroy?.();
});
</script>

<template>
  <div ref="host" class="aspect-video w-full bg-black"></div>
</template>
