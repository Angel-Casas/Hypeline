/**
 * Decoded size of `public/ffmpeg/ffmpeg-core.wasm`, in bytes.
 *
 * The core is served gzipped in production, so the response's `Content-Length` is the
 * compressed size and cannot drive a progress bar for a 32 MB download. This number can,
 * and `scripts/copy-ffmpeg-core.mjs` rewrites it whenever @ffmpeg/core is bumped — don't
 * edit it by hand.
 */
export const CORE_WASM_BYTES = 32232419;
