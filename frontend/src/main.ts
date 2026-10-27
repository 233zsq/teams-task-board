import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import BoardView from './views/BoardView.vue';
import { API_KEY } from './api/service';
import { createHttpApi } from './api/http';
import './styles.css';

async function start() {
  const api = import.meta.env.MODE === 'demo'
    ? (await import('./demo/api')).createDemoApi() : createHttpApi();
  const router = createRouter({ history: createWebHistory(), routes: [
    { path: '/', component: BoardView },
    { path: '/boards/:boardId', component: BoardView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: BoardView },
  ] });
  createApp(App).provide(API_KEY, api).use(router).mount('#app');
}
void start().catch(() => {
  const root = document.querySelector('#app');
  if (root) root.textContent = '应用启动失败，请刷新页面重试。';
});
