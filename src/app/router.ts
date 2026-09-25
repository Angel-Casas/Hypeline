import { START_LOCATION, createRouter, createWebHistory } from 'vue-router';
import { installed } from '@/lib/pwa';
import HomePage from '@/features/vod/HomePage.vue';
import DashboardPage from '@/features/vod/DashboardPage.vue';
import GalleryPage from '@/features/clips/GalleryPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/dashboard/:id?', name: 'dashboard', component: DashboardPage },
    { path: '/clips', name: 'clips', component: GalleryPage },
    // live mode lives on the dashboard since 2026-09-16 (ADR-18)
    {
      path: '/live/:channel?',
      redirect: (to) => ({
        name: 'dashboard',
        query: to.params.channel ? { channel: to.params.channel } : {},
      }),
    },
    // the old VOD page lives on the dashboard now
    { path: '/vod/:id', redirect: (to) => ({ name: 'dashboard', params: { id: to.params.id } }) },
  ],
});

/**
 * The installed app opens on the desk. The manifest's `start_url` says so, but a home-screen
 * icon placed before that change still launches at `/`, and iOS does not always re-read the
 * manifest — so the *first* navigation of a standalone session is sent on from the landing
 * page. Only the first: the rail's home button leads there on purpose (Angel, 2026-09-25).
 */
router.beforeEach((to, from) => {
  if (to.name === 'home' && from === START_LOCATION && installed.value)
    return { name: 'dashboard' };
  return true;
});
