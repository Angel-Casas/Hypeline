import { createRouter, createWebHistory } from 'vue-router';
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
