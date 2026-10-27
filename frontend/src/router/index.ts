import { createRouter, createWebHistory } from 'vue-router';

/** Page routes only; `/` always resolves to the board list workspace. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'boards',
      component: () => import('../pages/BoardsHomePage.vue'),
    },
    {
      path: '/boards/:boardId',
      name: 'board',
      component: () => import('../pages/BoardPage.vue'),
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../pages/NotFoundPage.vue'),
    },
  ],
});