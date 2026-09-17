<script setup lang="ts">
/**
 * The hype thread: WebGL silk ribbon shaped by a hype series (see
 * ui/thread/series.ts). Transparent by default so it composes over the app's
 * ground; `ground` paints its own atmosphere (landing page). `progress`
 * reveals the thread left to right; `window` shows a sub-range [t0, t1].
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ThreadSeries } from './thread/series';
import { FRAG, VERT } from './thread/shader';

const props = withDefaults(
  defineProps<{
    series: ThreadSeries;
    /** 0..1 fraction of the VOD drawn (1 = whole thread). */
    progress?: number;
    /** Visible range of the VOD, 0..1. */
    window?: [number, number];
    /** Thread centre as a fraction of height (from the bottom). */
    cy?: number;
    /** Thickness multiplier. */
    scale?: number;
    /** Horizontal span as fractions of width. */
    span?: [number, number];
    /** Draw the ink spine and tip dot. */
    ink?: boolean;
    /** Paint the pastel atmosphere behind (opaque). */
    ground?: boolean;
    /** Freeze animation (also honours prefers-reduced-motion). */
    still?: boolean;
    /**
     * Ripple on click: 'canvas' reacts to clicks on the canvas itself,
     * 'page' to any click on the page (landing), 'off' disables it.
     */
    ripple?: 'canvas' | 'page' | 'off';
    /** Keep the tip dot (the eye) once the thread is fully drawn. */
    endDot?: boolean;
    /** Night mode: ink spine/dot become paper-coloured, haze goes towards the dark ground. */
    dark?: boolean;
    /**
     * Portrait: the thread runs top → bottom (progress draws downward) and `cy` / the ribbon's
     * width are fractions of the canvas width, "up" being screen right. `span` is then along
     * the height.
     */
    vertical?: boolean;
  }>(),
  {
    progress: 1,
    window: () => [0, 1],
    cy: 0.5,
    scale: 1,
    span: () => [0, 1],
    ink: true,
    ground: false,
    still: false,
    ripple: 'canvas',
    endDot: false,
    dark: false,
    vertical: false,
  },
);

const canvas = ref<HTMLCanvasElement | null>(null);
const glOk = ref(false);
let gl: WebGLRenderingContext | null = null;
let raf = 0;
let tex: WebGLTexture | null = null;
let uniforms: Record<string, WebGLUniformLocation | null> = {};
let mouse: [number, number] = [0.5, 0.5];
let click: [number, number] = [0, 0];
let look: [number, number] = [0, 0]; // eased unit vector from the idle dot towards the pointer
let mouseIn = false;
let clickT = -100; // seconds on the u_time clock; far in the past = no ripple
let visible = true;
let t0 = 0;
const reduce =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function upload() {
  if (!gl || !tex) return;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    props.series.n,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    props.series.rgba,
  );
}
function resize() {
  const c = canvas.value;
  if (!c || !gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.floor(c.clientWidth * dpr));
  const h = Math.max(1, Math.floor(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    gl.viewport(0, 0, w, h);
  }
}
function frame() {
  raf = requestAnimationFrame(frame);
  if (!gl || !canvas.value || !visible) return;
  resize();
  gl.clear(gl.COLOR_BUFFER_BIT);
  const u = uniforms;
  gl.uniform2f(u.u_res!, canvas.value.width, canvas.value.height);
  gl.uniform1f(u.u_time!, (performance.now() - t0) / 1000);
  gl.uniform1f(u.u_prog!, props.progress);
  gl.uniform2f(u.u_mouse!, mouse[0], mouse[1]);
  gl.uniform1f(u.u_motion!, reduce || props.still ? 0 : 1);
  gl.uniform1f(u.u_t0!, props.window[0]);
  gl.uniform1f(u.u_t1!, props.window[1]);
  gl.uniform1f(u.u_cy!, props.cy);
  gl.uniform1f(u.u_scale!, props.scale);
  gl.uniform1f(u.u_ink!, props.ink ? 1 : 0);
  gl.uniform1f(u.u_ground!, props.ground ? 1 : 0);
  gl.uniform1f(u.u_x0!, props.span[0]);
  gl.uniform1f(u.u_x1!, props.span[1]);
  gl.uniform2f(u.u_click!, click[0], click[1]);
  gl.uniform1f(u.u_clickT!, clickT);
  // the idle eye looks towards the pointer (in canvas units, eased)
  {
    const c = canvas.value;
    const asp = props.vertical ? c.height / c.width : c.width / c.height;
    const dx0 = (props.span[0] + props.progress * (props.span[1] - props.span[0])) * asp;
    const dy0 = props.cy;
    let vx = mouseIn ? mouse[0] * asp - dx0 : 0;
    let vy = mouseIn ? mouse[1] - dy0 : 0;
    const len = Math.hypot(vx, vy) || 1;
    const k = Math.min(1, len / 0.25);
    vx = (vx / len) * k;
    vy = (vy / len) * k;
    look[0] += (vx - look[0]) * 0.08;
    look[1] += (vy - look[1]) * 0.08;
    gl.uniform2f(u.u_look!, look[0], look[1]);
  }
  gl.uniform1f(u.u_end!, props.endDot ? 1 : 0);
  gl.uniform1f(u.u_n!, props.series.n);
  gl.uniform1f(u.u_dark!, props.dark ? 1 : 0);
  gl.uniform1f(u.u_vert!, props.vertical ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function onMove(e: PointerEvent) {
  const r = canvas.value?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return;
  mouse = toThread((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  mouseIn = true;
}
function onLeave() {
  mouseIn = false;
}
/** Screen fractions (x right, y down) → the thread's landscape frame (x along, y "up"). */
function toThread(sx: number, sy: number): [number, number] {
  return props.vertical ? [sy, sx] : [sx, 1 - sy];
}
/** Ripple on click, in canvas units (x scaled by aspect, y up) — same clock as u_time. */
function onDown(e: PointerEvent) {
  const c = canvas.value;
  if (!c || props.ripple === 'off') return;
  if ((e.target as Element | null)?.closest?.('button, input, a, select, textarea')) return;
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const [x, y] = toThread((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  if (props.ripple === 'canvas' && (x < 0 || x > 1 || y < 0 || y > 1)) return;
  click = [x * (props.vertical ? r.height / r.width : r.width / r.height), y];
  clickT = (performance.now() - t0) / 1000;
}
let io: IntersectionObserver | null = null;

onMounted(() => {
  const c = canvas.value!;
  gl = c.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return; // the CSS fallback gradient stays visible
  glOk.value = true;
  const sh = (type: number, src: string) => {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) console.error(gl!.getShaderInfoLog(s));
    return s;
  };
  const prg = gl.createProgram()!;
  gl.attachShader(prg, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prg, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prg);
  gl.useProgram(prg);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prg, 'a');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  for (const n of [
    'u_res',
    'u_time',
    'u_prog',
    'u_mouse',
    'u_motion',
    'u_series',
    'u_t0',
    'u_t1',
    'u_cy',
    'u_scale',
    'u_ink',
    'u_ground',
    'u_x0',
    'u_x1',
    'u_click',
    'u_clickT',
    'u_look',
    'u_end',
    'u_n',
    'u_dark',
    'u_vert',
  ])
    uniforms[n] = gl.getUniformLocation(prg, n);
  tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); // the shader splines the samples itself
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.u_series!, 0);
  upload();
  gl.disable(gl.BLEND); // the shader writes straight colour + alpha; the page composites
  gl.clearColor(0, 0, 0, 0);
  t0 = performance.now();
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('mouseleave', onLeave);
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting)));
    io.observe(c);
  }
  raf = requestAnimationFrame(frame);
});
watch(() => props.series, upload);
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerdown', onDown);
  document.removeEventListener('mouseleave', onLeave);
  io?.disconnect();
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
});
</script>

<template>
  <canvas
    ref="canvas"
    class="hype-thread block h-full w-full"
    :class="{ 'no-gl': !glOk }"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
.hype-thread.no-gl {
  /* Fallback when WebGL is unavailable: a quiet pastel band. */
  background: linear-gradient(
    90deg,
    transparent,
    rgba(244, 196, 207, 0.35) 30%,
    rgba(200, 219, 242, 0.35) 70%,
    transparent
  );
  background-size: 100% 8%;
  background-repeat: no-repeat;
  background-position: 0 50%;
}
</style>
