/** The thread's palette ("Stripe silk, softened") as CSS colours, in thread order. */
export const SILK = ['#8eb0ff', '#ae81ff', '#ff77b5', '#ffa968', '#ffde68'];

/**
 * The silk's colour at position `t` (0..1 of the VOD), pulled 22% towards the ink so the
 * paler silks (butter, sky) stay legible as small text; `dark` pulls towards paper instead.
 * `mix` overrides the 22%.
 */
export function silkAt(t: number, dark = false, mix = 0.22): string {
  const s = Math.max(0, Math.min(0.9999, t)) * (SILK.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  const a = SILK[i]!;
  const b = SILK[i + 1]!;
  const INK = dark ? [0xf3, 0xed, 0xf6] : [0x22, 0x1c, 0x2a];
  const ch = (k: number, j: number) =>
    Math.round(
      (parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f) *
        (1 - mix) +
        INK[j]! * mix,
    );
  return `rgb(${ch(1, 0)} ${ch(3, 1)} ${ch(5, 2)})`;
}
