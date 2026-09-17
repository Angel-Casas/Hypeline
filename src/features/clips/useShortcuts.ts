/**
 * Keyboard shortcuts for the editor. Ignored while typing in inputs/selects.
 *  I / O      set in / out at the playhead
 *  [ / ]      seek to in / out
 *  ← / →      seek ±1 s (Shift: ±5 s)
 *  J / L      seek −10 s / +10 s     K or Space  play/pause
 *  , / .      previous / next peak   Enter       select the nearest peak
 *  E          export                 ?           list shortcuts (console)
 */
import { onBeforeUnmount, onMounted } from 'vue';

export interface ShortcutHandlers {
  setIn(): void;
  setOut(): void;
  seekBy(deltaSec: number): void;
  seekTo(which: 'in' | 'out'): void;
  togglePlay(): void;
  exportClip(): void;
  /** , / . — playhead to the previous / next moment pin. */
  jumpPeak(dir: -1 | 1): void;
  /** Enter — select the moment nearest the playhead (seek + clip range + zoom). */
  selectPeak(): void;
}

/**
 * The keyboard shortcuts, for the help popover (ui/ShortcutsHelp.vue). `id` is the message
 * key under `shortcuts.actions` (src/i18n/parts/dashboard.json) that says what the keys do.
 */
export const SHORTCUTS: { id: string; keys: string[] }[] = [
  { id: 'setInOut', keys: ['I', 'O'] },
  { id: 'jumpInOut', keys: ['[', ']'] },
  { id: 'nudge', keys: ['←', '→'] },
  { id: 'backForward', keys: ['J', 'L'] },
  { id: 'prevNextMoment', keys: [',', '.'] },
  { id: 'clipNearest', keys: ['Enter'] },
  { id: 'playPause', keys: ['K', 'Space'] },
  { id: 'exportClip', keys: ['E'] },
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useShortcuts(h: ShortcutHandlers) {
  function onKey(e: KeyboardEvent) {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'i':
      case 'I':
        h.setIn();
        break;
      case 'o':
      case 'O':
        h.setOut();
        break;
      case '[':
        h.seekTo('in');
        break;
      case ']':
        h.seekTo('out');
        break;
      case 'ArrowLeft':
        h.seekBy(e.shiftKey ? -5 : -1);
        break;
      case 'ArrowRight':
        h.seekBy(e.shiftKey ? 5 : 1);
        break;
      case ',':
        h.jumpPeak(-1);
        break;
      case '.':
        h.jumpPeak(1);
        break;
      case 'Enter':
        h.selectPeak();
        break;
      case 'j':
      case 'J':
        h.seekBy(-10);
        break;
      case 'l':
      case 'L':
        h.seekBy(10);
        break;
      case 'k':
      case 'K':
      case ' ':
        h.togglePlay();
        break;
      case 'e':
      case 'E':
        h.exportClip();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
}
