import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BoardSidebar from '../src/features/boards/BoardSidebar.vue';
import { ApiError } from '../src/api/client';
import { createWorkspaceStore } from '../src/state/workspace';
import {
  BOARD_A,
  BOARD_B,
  createFakeApi,
  deferred,
  mountWithWorkspace,
} from './helpers/test-context';

function mountSidebar(
  store: ReturnType<typeof createWorkspaceStore>,
  props: Record<string, unknown> = {},
): ReturnType<typeof mountWithWorkspace> {
  return mountWithWorkspace(BoardSidebar, store, {
    props: {
      boards: [BOARD_A, BOARD_B],
      currentBoardId: BOARD_A.id,
      listStatus: 'ready',
      listError: null,
      ...props,
    },
  });
}

describe('board navigation', () => {
  it('lists boards with business-zone creation time and marks the active one', () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    const text = wrapper.text();
    expect(text).toContain('课程作业');
    expect(text).toContain('答辩准备');
    // 02:00Z renders as 10:00 in Asia/Shanghai, minute precision.
    expect(text).toContain('创建于 2026-10-20 10:00');

    const active = wrapper.find('.board-nav-item.is-active');
    expect(active.text()).toContain('课程作业');
    expect(active.attributes('aria-current')).toBe('true');
  });

  it('emits the selected board id', async () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    await wrapper.findAll('.board-nav-item')[1]!.trigger('click');

    expect(wrapper.emitted('select')).toEqual([[BOARD_B.id]]);
  });

  it('validates the name before calling the API', async () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    await wrapper.find('form.create-board').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('看板名称不能为空');
    expect(api.calls.filter((call) => call.method === 'createBoard')).toHaveLength(0);
  });

  it('creates a board, clears the input and emits created', async () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    await wrapper.find('#new-board-name').setValue('  产品原型  ');
    await wrapper.find('form.create-board').trigger('submit');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'createBoard')?.args).toEqual([
      { name: '产品原型' },
    ]);
    expect(wrapper.emitted('created')).toHaveLength(1);
    expect((wrapper.find('#new-board-name').element as HTMLInputElement).value).toBe('');
  });

  it('submits only once while a creation request is pending', async () => {
    const pending = deferred<typeof BOARD_A>();
    const api = createFakeApi({ createBoard: async () => pending.promise });
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    await wrapper.find('#new-board-name').setValue('课程作业');
    const form = wrapper.find('form.create-board');
    void form.trigger('submit');
    void form.trigger('submit');
    await flushPromises();

    expect(api.calls.filter((call) => call.method === 'createBoard')).toHaveLength(1);

    pending.resolve(BOARD_A);
    await flushPromises();
  });

  it('keeps the name and shows the error when creation fails', async () => {
    const api = createFakeApi({
      createBoard: async () => {
        throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
      },
    });
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store);

    await wrapper.find('#new-board-name').setValue('课程作业');
    await wrapper.find('form.create-board').trigger('submit');
    await flushPromises();

    expect((wrapper.find('#new-board-name').element as HTMLInputElement).value).toBe('课程作业');
    expect(wrapper.text()).toContain('服务暂不可用，请稍后重试');
  });

  it('disables switching while creation is locked', () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store, { switchingDisabled: true });

    for (const button of wrapper.findAll('.board-nav-item')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });

  it('shows a retry entry when the list read failed', async () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountSidebar(store, {
      boards: [],
      listStatus: 'error',
      listError: new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' }),
    });

    expect(wrapper.text()).toContain('服务暂不可用，请稍后重试');
    await wrapper.find('.sidebar-error button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});