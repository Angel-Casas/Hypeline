import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './app/router';
import { i18n, applyLang } from './i18n';
import { setupPwa } from './lib/pwa';
import './style.css';

applyLang();
setupPwa();
createApp(App).use(createPinia()).use(router).use(i18n).mount('#app');
