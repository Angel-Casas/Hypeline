/**
 * The app as an app (2026-09-17). Two quiet signals, no modals:
 *
 *  - `installable` turns true when the browser offers an install (Chromium fires
 *    `beforeinstallprompt`, which we keep so the rail can ask at a moment the user chose).
 *    Safari and Firefox never fire it, so nothing is shown there rather than a "how to
 *    install" lecture. A dismissal is remembered.
 *  - `needRefresh` turns true when a new build is waiting in the service worker. Nothing is
 *    swapped under the user's feet mid-clip: they press Reload when they like.
 */
import { ref } from 'vue';
import { registerSW } from 'virtual:pwa-register';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'hypeline.install.dismissed';
/**
 * How often an open tab asks whether a new build has been published. The browser only checks
 * on its own when the page navigates, so a tab left open all afternoon never hears about a
 * deploy — Angel had to reload before the "new version" toast appeared, which is the one
 * thing the toast exists to save him (2026-09-17).
 */
const UPDATE_EVERY_MS = 15 * 60 * 1000;
/** However often the tab is focused, at most one check a minute. */
const UPDATE_MIN_GAP_MS = 60 * 1000;

export const installable = ref(false);
export const needRefresh = ref(false);
/** True once the app runs from the home screen — nothing to install then. */
export const installed = ref(
  typeof matchMedia === 'function' &&
    (matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true),
);

let deferred: InstallPrompt | null = null;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Ask the service worker to re-fetch itself; if the build behind it changed, it installs and
 * waits, and `onNeedRefresh` raises the toast. Cheap — one conditional request for `sw.js`.
 * `force` skips the gap (coming back online is worth a look straight away).
 */
export async function checkForUpdate(force = false): Promise<void> {
  if (!registration) return;
  if (!force && Date.now() - lastCheck < UPDATE_MIN_GAP_MS) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  lastCheck = Date.now();
  try {
    await registration.update();
  } catch {
    /* offline, or the registration went away with the tab's worker */
  }
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setupPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it: the browser's own bar is not ours to place
    deferred = e as InstallPrompt;
    installable.value = !dismissed() && !installed.value;
  });
  window.addEventListener('appinstalled', () => {
    installable.value = false;
    installed.value = true;
    deferred = null;
  });
  // a window event announces a waiting build too: the service worker's own signal is hard to
  // provoke from a test, and a future "check for updates" button can reuse it
  window.addEventListener('hypeline:update-ready', () => (needRefresh.value = true));
  // an open tab should notice a deploy by itself: every quarter of an hour, and whenever the
  // user comes back to the tab or the network returns — the moments a stale page matters
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.addEventListener('online', () => void checkForUpdate(true));
  applyUpdate = registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      registration = r ?? null;
      lastCheck = Date.now();
      if (registration && !timer) timer = setInterval(() => void checkForUpdate(), UPDATE_EVERY_MS);
    },
    onNeedRefresh() {
      needRefresh.value = true;
    },
  });
}

/** Ask the browser to install; resolves to what the user chose. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  installable.value = false;
  if (outcome === 'dismissed') remember();
  return outcome;
}

/** "Not now" — do not ask again in this browser. */
export function dismissInstall() {
  installable.value = false;
  remember();
}
function remember() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode */
  }
}

/**
 * Swap in the waiting build and reload. `registerSW`'s own reload only happens once the new
 * worker takes over, so a plain reload backs it up — the page must come back either way.
 */
export async function reloadForUpdate() {
  needRefresh.value = false;
  try {
    await applyUpdate?.(true);
  } catch {
    /* the worker went away: the reload below is enough */
  }
  setTimeout(() => location.reload(), 1200);
}
