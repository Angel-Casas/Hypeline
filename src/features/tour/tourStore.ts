/**
 * The first-visit tour (2026-09-17): five quick steps over the desk — heatmap, moments, clip,
 * AI, rail — drawn on the example VOD. `seen` lives in localStorage; Settings can ask for it
 * again (`request()`), which the dashboard answers by loading the example and starting it.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const TOUR_KEY = 'hypeline.tour.v1';

export const useTourStore = defineStore('tour', () => {
  const seen = ref(readSeen());
  const active = ref(false);
  const step = ref(0);
  /** Set by Settings ("show the tour again"); the dashboard consumes it. */
  const requested = ref(false);

  function readSeen(): boolean {
    try {
      return localStorage.getItem(TOUR_KEY) === 'done';
    } catch {
      return false;
    }
  }
  function markSeen() {
    seen.value = true;
    try {
      localStorage.setItem(TOUR_KEY, 'done');
    } catch {
      /* private mode */
    }
  }
  function start() {
    step.value = 0;
    active.value = true;
    requested.value = false;
  }
  /** Both "Done" and "Skip" end it for good; the tour is one Settings click away. */
  function end() {
    active.value = false;
    markSeen();
  }
  function request() {
    requested.value = true;
  }

  return { seen, active, step, requested, start, end, request, markSeen };
});
