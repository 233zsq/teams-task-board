import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { STATUS_LABELS, type Task, type TaskStatus } from '@team-plan/shared';
import BoardWorkspace from '../src/features/tasks/BoardWorkspace.vue';
import { ApiError } from '../src/api/client';
import { createWorkspaceStore } from '../src/state/workspace';
import {
  BOARD_A,
  MEMBERS,
  createFakeApi,
  makeTask,
  mountWithWorkspace,
} from './helpers/test-context';

function setup(tasks: Task[]): {
  api: ReturnType<typeof createFakeApi>;
  store: ReturnType<typeof createWorkspaceStore>;
  wrapper: ReturnType<typeof mountWithWorkspace>;
} {
  const api = createFakeApi({ listTasks: async () => tasks, getBoard: async () => BOARD_A });
  const store = createWorkspaceStore(api);

  store.state.currentBoardId = BOARD_A.id;
  store.state.boards = { status: 'ready', data: [BOARD_A], error: null };
  store.state.members = { status: 'ready', data: MEMBERS, error: null };
  store.state.board = { status: 'ready', data: BOARD_A, error: null };
  store.state.tasks = { status: 'ready', data: tasks, error: null };
  store.state.lastRefreshedAt = Date.now();

  const wrapper = mountWithWorkspace(BoardWorkspace, store, { attachTo: document.body });
  return { api, store, wrapper };
}

function buttonByText(
  wrapper: ReturnType<typeof mountWithWorkspace>,
  text: string,
): ReturnType<typeof wrapper.find> {
  const button = wrapper.findAll('button').find((item) => item.text() === text);
  if (button === undefined) {
    throw new Error(`button not found: ${text}`);
  }
  return button;
}

const ALL_TRANSITIONS: Array<[TaskStatus, TaskStatus]> = [
  ['todo', 'doing'],
  ['todo', 'done'],
  ['doing', 'todo'],
  ['doing', 'done'],
  ['done', 'todo'],
  ['done', 'doing'],
];

describe('status changes and deletion', () => {
  it('sends a complete PUT for all six status transitions', async () => {
    for (const [from, to] of ALL_TRANSITIONS) {
      const task = makeTask({
        id: 't1',
        title: '流转任务',
        description: '描述',
        dueDate: '2026-10-23',
        assigneeId: MEMBERS[0]!.id,
        status: from,
      });
      const { api, store, wrapper } = setup([task]);

      await wrapper.find('[data-task-id="t1"]').trigger('click');
      const target = wrapper
        .findAll('[role="dialog"] .segmented__item')
        .find((button) => button.text() === STATUS_LABELS[to]);
      await target!.trigger('click');
      await flushPromises();

      const call = api.calls.find((item) => item.method === 'updateTask');
      expect(call?.args[0]).toBe(BOARD_A.id);
      expect(call?.args[1]).toBe('t1');
      expect(call?.args[2]).toEqual({
        title: '流转任务',
        description: '描述',
        dueDate: '2026-10-23',
        assigneeId: MEMBERS[0]!.id,
        status: to,
      });
      expect(store.state.tasks.data[0]!.status).toBe(to);

      wrapper.unmount();
    }
  });

  it('keeps the original status and reports a failed change', async () => {
    const task = makeTask({ id: 't1', status: 'todo' });
    const { api, store, wrapper } = setup([task]);
    api.set('updateTask', async () => {
      throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
    });

    await wrapper.find('[data-task-id="t1"]').trigger('click');
    const doing = wrapper
      .findAll('[role="dialog"] .segmented__item')
      .find((button) => button.text() === '进行中');
    await doing!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('服务暂不可用，请稍后重试');
    expect(store.state.tasks.data[0]!.status).toBe('todo');
    expect(doing!.attributes('aria-pressed')).toBe('false');
  });

  it('defaults the delete confirmation focus to cancel and does not delete', async () => {
    const tasks = [makeTask({ id: 't1', title: '第一个' }), makeTask({ id: 't2', title: '第二个' })];
    const { api, wrapper } = setup(tasks);

    await wrapper.find('[data-task-id="t1"]').trigger('click');
    await buttonByText(wrapper, '删除').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('删除后不可恢复');
    expect(wrapper.text()).toContain('第一个');
    expect(document.activeElement?.textContent).toContain('取消');

    await buttonByText(wrapper, '取消').trigger('click');
    await flushPromises();

    expect(api.calls.filter((call) => call.method === 'deleteTask')).toHaveLength(0);
    expect(wrapper.find('[data-task-id="t1"]').exists()).toBe(true);
  });

  it('deletes on confirm, removes only that card and moves focus to the neighbor', async () => {
    const tasks = [makeTask({ id: 't1', title: '第一个' }), makeTask({ id: 't2', title: '第二个' })];
    const { api, store, wrapper } = setup(tasks);

    await wrapper.find('[data-task-id="t1"]').trigger('click');
    await buttonByText(wrapper, '删除').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '删除任务').trigger('click');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'deleteTask')?.args).toEqual([
      BOARD_A.id,
      't1',
    ]);
    expect(wrapper.find('[data-task-id="t1"]').exists()).toBe(false);
    expect(wrapper.find('[data-task-id="t2"]').exists()).toBe(true);
    expect(store.state.tasks.data.map((task) => task.id)).toEqual(['t2']);
    expect(document.activeElement?.getAttribute('data-task-id')).toBe('t2');
  });

  it('keeps the card and shows the error when deletion fails', async () => {
    const tasks = [makeTask({ id: 't1', title: '第一个' })];
    const { api, wrapper } = setup(tasks);
    api.set('deleteTask', async () => {
      throw new ApiError({ kind: 'http', status: 500, code: 'INTERNAL_ERROR' });
    });

    await wrapper.find('[data-task-id="t1"]').trigger('click');
    await buttonByText(wrapper, '删除').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '删除任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('服务器内部错误，请稍后重试');
    expect(wrapper.find('[data-task-id="t1"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('删除任务');
  });

  it('reports a task deleted by another browser and refreshes', async () => {
    const tasks = [makeTask({ id: 't1', title: '第一个' }), makeTask({ id: 't2', title: '第二个' })];
    const { api, store, wrapper } = setup(tasks);

    let current = [...tasks];
    api.set('deleteTask', async () => {
      current = [tasks[1]!];
      throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
    });
    api.set('listTasks', async () => current);

    await wrapper.find('[data-task-id="t1"]').trigger('click');
    await buttonByText(wrapper, '删除').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '删除任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('任务已不存在');
    expect(store.state.tasks.data.map((task) => task.id)).toEqual(['t2']);
    expect(api.calls.filter((call) => call.method === 'getBoard').length).toBeGreaterThan(0);
  });
});