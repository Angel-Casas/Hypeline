/**
 * Static hosts (GitHub Pages, and most others) look for a file at the path in the URL, so a
 * deep link like /dashboard/2871164819 — or Twitch's OAuth redirect to /dashboard — 404s on a
 * hard load even though the app's router knows the route. Copying index.html to 404.html hands
 * those requests back to the app, which then reads the path itself (2026-09-17).
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const index = join(dist, 'index.html');
if (!existsSync(index)) {
  console.error('spa-fallback: no dist/index.html — run the build first');
  process.exit(1);
}
copyFileSync(index, join(dist, '404.html'));
console.log('spa-fallback: dist/404.html written');
