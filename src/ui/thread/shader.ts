/**
 * The hype thread ("Spindle · hue", chosen 2026-09-13): a symmetric silk
 * ribbon whose width follows the chat hype series, coloured per moment, with
 * the data drawn as an ink spine. See docs/08-design-system.md.
 */
export const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

export const FRAG = /* glsl */ `
precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_prog; uniform vec2 u_mouse; uniform float u_motion;
uniform sampler2D u_series; uniform float u_t0; uniform float u_t1; uniform float u_cy; uniform float u_scale;
uniform float u_ink; uniform float u_ground; uniform float u_x0; uniform float u_x1;
uniform vec2 u_click; uniform float u_clickT; uniform vec2 u_look; uniform float u_end; uniform float u_n; uniform float u_dark; uniform float u_vert;
/* what the far parts of the silk haze towards: the paper (white by day, ink by night) */
vec3 paperCol(){ return mix(vec3(1.0), vec3(0.0, 0.0, 0.0), u_dark); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a*noise(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
/* Palette "Stripe silk, softened" (Angel, 2026-09-13): Stripe's blue→violet→pink→orange→yellow, ~15% towards white. */
vec3 pal(float t){ vec3 blue = vec3(0.557,0.69,1.0), violet = vec3(0.683,0.507,1.0), pink = vec3(1.0,0.467,0.71), orange = vec3(1.0,0.663,0.407), yellow = vec3(1.0,0.87,0.407);
  t = fract(t); float s = t*5.0; int i = int(floor(s)); float f = fract(s); vec3 c;
  if (i == 0) c = mix(blue, violet, f); else if (i == 1) c = mix(violet, pink, f); else if (i == 2) c = mix(pink, orange, f); else if (i == 3) c = mix(orange, yellow, f); else c = mix(yellow, blue, f);
  float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, 1.05); }
/* The silk: one continuous ribbon with depth. Along its length and across its width the ribbon
   comes towards the viewer and recedes: near = crisp edge, fine streaks, full colour; far = soft
   (out-of-focus) edge, streaks fade, a little paler. dS is the signed distance from the spine in
   ribbon half-widths (+ above, − below) so each edge can be at its own depth; px = half width in
   pixels (the in-focus edge is a fixed ~1.5 px). */
vec4 silk(float x, float dS, float px, float hue, float T){
  float ad = abs(dS); float side = smoothstep(-0.35, 0.35, dS);
  // the silk's own clock (colour drift, waves, focus): a touch brisker than real time (Angel, 2026-09-15)
  float t = u_time*u_motion*1.3;
  // depth of each edge drifts along the length; the two edges are out of phase so the ribbon twists
  float farTop = smoothstep(0.15, 0.85, 0.5 + 0.5*sin(T*7.0 + 0.8 + t*0.05));
  float farBot = smoothstep(0.15, 0.85, 0.5 + 0.5*sin(T*7.0 + 3.9 + t*0.045));
  float far = mix(farBot, farTop, side);
  float crisp = 1.6/max(px, 2.0);
  float soft = mix(crisp, 0.55, far);
  // the out-of-focus edge also spreads a little beyond the ribbon's width
  float edge = 1.0 - smoothstep(1.0 - soft*0.7, 1.0 + soft*0.5, ad); if (edge <= 0.0) return vec4(0.0);
  float warp = (fbm(vec2(x*0.9 + t*0.04, dS*1.2)) - 0.5) * 0.35; float dd = dS + warp;
  // depth across the width too: bands of the ribbon nearer or farther than their neighbours
  float band = smoothstep(0.2, 0.8, 0.5 + 0.5*sin(dd*2.6 + x*0.7 + t*0.05));
  float near = (1.0 - far) * (0.55 + 0.45*band);
  // colour: smooth bands across the width, drifting slowly along the length and with time
  vec3 col = pal(0.77 + dd*0.11 + x*0.085 + 0.12 + hue + t*0.003);
  // streaks along the flow: a coarse brush (dozens) and, where the ribbon is near, a fine one (hundreds)
  float coarse = noise(vec2(x*1.6 - t*0.05, dd*22.0));
  float fine   = noise(vec2(x*3.0 - t*0.08, dd*70.0));
  float fineAmt = 0.14 * near * smoothstep(14.0, 60.0, px);
  col *= 0.97 + (0.08 + 0.08*near)*(coarse - 0.5) + fineAmt*(fine - 0.5);
  // a gentle fold shadow where the ribbon turns, a soft sheen along the middle, haze where it is far
  float fold = smoothstep(-0.2, 0.9, sin(x*2.6 + 3.0 + t*0.08 + dd*1.2));
  col = mix(col, col*0.86, fold*0.3*near);
  col = mix(col, vec3(1.0), pow(max(0.0, 1.0-ad), 4.0)*0.2); col = mix(col, paperCol(), 0.14*(1.0 - near));
  // far parts sit behind: slightly translucent
  return vec4(col, edge*(0.82 + 0.18*near)); }
/* ink for the spine / dot / eye: ink on paper by day, paper on ink by night */
vec3 inkCol(){ return mix(vec3(0.13, 0.11, 0.16), vec3(0.95, 0.93, 0.96), u_dark); }
float sway(float T){ return smoothstep(0.0, 0.06, T) * smoothstep(1.0, 0.94, T); }
float ink(float dRaw, float w){ return 1.0 - smoothstep(w, w + 0.0022, abs(dRaw)); }
void main(){
  // portrait (u_vert): the thread runs top→bottom and its "up" is screen right; everything below
  // works in the landscape frame, so just turn the fragment and the resolution
  vec2 res = mix(u_res, u_res.yx, u_vert);
  vec2 fc = mix(gl_FragCoord.xy, vec2(u_res.y - gl_FragCoord.y, gl_FragCoord.x), u_vert);
  vec2 uv = fc / res; float asp = res.x / res.y; vec2 p = vec2(uv.x*asp, uv.y);
  vec3 col = vec3(0.984, 0.976, 0.98);
  if (u_ground > 0.5) {
    col = mix(col, vec3(0.97,0.91,0.94), 0.3*fbm(vec2(uv.x*1.3 + u_time*0.02*u_motion, uv.y*1.3)));
    col = mix(col, vec3(0.91,0.94,0.99), 0.25*fbm(vec2(uv.x*1.1 - 3.0, uv.y*1.4 + u_time*0.015*u_motion)));
  }
  float alpha = u_ground > 0.5 ? 1.0 : 0.0;
  float X = (uv.x - u_x0) / (u_x1 - u_x0);
  if (X >= -0.08 && X <= 1.08) {
    float T = u_t0 + clamp(X, 0.0, 1.0)*(u_t1 - u_t0);
    // series: 16-bit hype (R high, B low) sampled with a Catmull-Rom spline over the 4 nearest
    // texels, so the ribbon's edge is a smooth curve rather than straight segments
    float fx = T*u_n - 0.5; float i0 = floor(fx); float f = fx - i0;
    vec4 s0 = texture2D(u_series, vec2((i0 - 0.5)/u_n, 0.5)), s1 = texture2D(u_series, vec2((i0 + 0.5)/u_n, 0.5));
    vec4 s2 = texture2D(u_series, vec2((i0 + 1.5)/u_n, 0.5)), s3 = texture2D(u_series, vec2((i0 + 2.5)/u_n, 0.5));
    vec4 hs = vec4(s0.r + s0.b/255.0, s1.r + s1.b/255.0, s2.r + s2.b/255.0, s3.r + s3.b/255.0) * (255.0/256.0);
    float f2 = f*f, f3 = f2*f;
    float h = 0.5*((2.0*hs.y) + (-hs.x + hs.z)*f + (2.0*hs.x - 5.0*hs.y + 4.0*hs.z - hs.w)*f2 + (-hs.x + 3.0*hs.y - 3.0*hs.z + hs.w)*f3);
    h = clamp(h, 0.0, 1.0);
    float hue = mix(s1.g, s2.g, f);
    float r = 1.0 - smoothstep(u_prog - 0.06, u_prog + 0.005, T);
    // ends: the thread starts and finishes as a point, never a cut edge
    float ends = smoothstep(0.0, 0.05, T) * smoothstep(1.0, 0.955, T);
    // the spine sways slowly, but not at its ends: the eye must sit still where it rests
    // (the scroll hint is aligned to it)
    float cy0 = u_cy + 0.015*sin(T*7.0 + u_time*0.1*u_motion)*u_scale*sway(T);
    float cy = cy0; float wid = (0.015 + 0.21*h)*u_scale * ends; float dy = p.y - cy;
    // the ribbon reaches |dy| = wid on each side (as before: the old call measured from wid/2 out to wid)
    float pxw = wid*res.y;
    vec4 c = silk(T*4.6, dy / max(wid, 1e-5), pxw, hue, T);
    c.a *= r * smoothstep(0.0, 0.02, T);
    // ripple on click: a bright pulse runs along the silk both ways from the click and fades
    float age = u_time - u_clickT;
    if (age >= 0.0 && age < 3.0) {
      float dcl = abs(p.x - u_click.x);
      float wave = exp(-pow((dcl - age*0.55) / 0.045, 2.0)) * exp(-age*1.3) * u_motion;
      c.rgb = mix(c.rgb, vec3(1.0), wave*0.7);
    }
    if (u_ground > 0.5) { col = mix(col, c.rgb, c.a); } else { col = c.rgb; alpha = c.a; }
    float spine = ink(dy, 0.0012*u_scale + 0.0002)*r*0.9*u_ink*smoothstep(0.0, 0.02, T)*smoothstep(1.0, 0.98, T); col = mix(col, inkCol(), spine); alpha = max(alpha, spine);
    float tipx = (u_prog - u_t0) / (u_t1 - u_t0);
    float tipT = u_prog;
    float tipCy = u_cy + 0.015*sin(tipT*7.0 + u_time*0.1*u_motion)*u_scale*sway(tipT);
    vec2 tipPos = vec2((u_x0 + tipx*(u_x1-u_x0))*asp, tipCy);
    // idle: before the first scroll (and, with u_end, once the thread is fully drawn) the dot is a
    // small creature — an eye that looks towards the pointer, blinks every few seconds and has a glint
    float idle = ((1.0 - smoothstep(0.0, 0.03, u_prog)) + smoothstep(0.985, 1.0, u_prog) * u_end) * u_motion;
    vec2 D = tipPos + u_look * 0.006 * idle;
    float bt = fract(u_time/3.3);
    float blink = exp(-pow((bt - 0.6)/0.022, 2.0));
    blink = max(blink, exp(-pow((bt - 0.68)/0.022, 2.0)) * step(0.5, fract(floor(u_time/3.3)*0.37))) * idle;
    vec2 e = p - D; e.y /= max(0.08, 1.0 - 0.95*blink);
    float rad = 0.0065;
    float dot = (1.0 - smoothstep(rad, rad + 0.003, length(e))) * max(step(u_prog, 0.999), u_end) * u_ink;
    float glint = (1.0 - smoothstep(0.0016, 0.0028, length(p - (D + vec2(-0.0022, 0.0024))))) * (1.0 - blink) * idle;
    dot *= 1.0 - glint;
    col = mix(col, inkCol(), dot); alpha = max(alpha, dot);
  }
  gl_FragColor = vec4(col, alpha);
}
`;
