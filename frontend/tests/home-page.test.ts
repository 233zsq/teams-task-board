import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import BoardsHomePage from '../src/pages/BoardsHomePage.vue';
import { createWorkspaceStore, type WorkspaceStore } from '../src/state/workspace';
import { BOARD_A, createFakeApi, mountWithWorkspace } from './helpers/test-context';

async function mountHome(api: ReturnType<typeof createFakeApi>): Promise<{
  store: WorkspaceStore;
  router: Router;
  wrapper: ReturnType<typeof mountWithWorkspace>;
}> {
  const store = createWorkspaceStore(api);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: BoardsHomePage },
      { path: '/boards/:boardId', component: { template: '<div>看板视图</div>' } },
    ],
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mountWithWorkspace(BoardsHomePage, store, {
    global: { plugins: [router] },
    attachTo: document.body,
  });

  return { store, router, wrapper };
}

describe('boards home page', () => {
  it('shows the creation guide on an empty database', async () => {
    const api = createFakeApi({ listBoards: async () => [] });
    const { wrapper } = await mountHome(api);
    await flushPromises();

    expect(wrapper.text()).toContain('还没有看板');
    expect(wrapper.find('#new-board-guide-name').exists()).toBe(true);
    expect(wrapper.findAll('.board-column')).toHaveLength(0);
  });

  it('opens the new board created from the guide (guide unmounts with the create)', async () => {
    const api = createFakeApi({ listBoards: async () => [] });
    const { router, wrapper } = await mountHome(api);
    await flushPromises();

    await wrapper.find('#new-board-guide-name').setValue('  课程作业  ');
    await wrapper.find('.state-panel--guide form').trigger('submit');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'createBoard')?.args).toEqual([
      { name: '课程作业' },
    ]);
    // The guide is gone (a board now exists) and the page selected the new board.
    expect(wrapper.text()).not.toContain('还没有看板');
    expect(router.currentRoute.value.path).toBe(
      '/boards/22222222-2222-4222-8222-222222222299',
    );
  });

  it('treats a create failure as a retryable error and keeps the name', async () => {
    const api = createFakeApi({ listBoards: async () => [] });
    const { router, wrapper } = await mountHome(api);
    await flushPromises();

    api.set('createBoard', async () => {
      throw new Error('network down');
    });
    await wrapper.find('#new-board-guide-name').setValue('课程作业');
    await wrapper.find('.state-panel--guide form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('还没有看板');
    expect((wrapper.find('#new-board-guide-name').element as HTMLInputElement).value).toBe(
      '课程作业',
    );
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('redirects to the first board by createdAt/id when boards exist', async () => {
    const api = createFakeApi({ listBoards: async () => [BOARD_A] });
    const { router } = await mountHome(api);
    await flushPromises();

    expect(router.currentRoute.value.path).toBe(`/boards/${BOARD_A.id}`);
  });
});