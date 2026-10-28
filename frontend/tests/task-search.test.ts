import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../src/state/workspace';
import { ApiError } from '../src/api/client';
import { account } from '../src/state/account';
import BoardWorkspace from '../src/features/tasks/BoardWorkspace.vue';
import TaskFilterBar from '../src/features/tasks/TaskFilterBar.vue';
import { BOARD_A, BOARD_B, MEMBERS, createFakeApi, deferred, makeTask, mountWithWorkspace } from './helpers/test-context';
import type { Task, TaskFieldInput } from '@team-plan/shared';

afterEach(() => { account.user = null; });

describe('task query state and view', () => {
  it('keeps the full snapshot separate from filtered results and clears without another request', async () => {
    const all = [makeTask({ id: 'one', priority: 'high' }), makeTask({ id: 'two', priority: 'low' })];
    const api = createFakeApi({ listTasks: async (_board, _signal, filters) => filters?.priority ? [all[0]!] : all });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id);
    await store.applyTaskFilters({ priority: 'high' });
    expect(store.state.tasks.data).toHaveLength(2); expect(store.state.taskResults.data).toEqual([all[0]]);
    const before = api.calls.length; await store.applyTaskFilters({});
    expect(store.state.taskResults.status).toBe('idle'); expect(api.calls).toHaveLength(before);
  });
  it('rejects stale query responses even if an HTTP adapter ignores abort', async () => {
    const slow = deferred<Task[]>();
    const api = createFakeApi({ listTasks: async (_board, _signal, filters) => filters?.q === 'old' ? slow.promise : [makeTask({ title: 'new' })] });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id);
    const previous = store.applyTaskFilters({ q: 'old' });
    await store.applyTaskFilters({ q: 'new' }); slow.resolve([makeTask({ title: 'old' })]); await previous;
    expect(store.state.taskResults.data[0]?.title).toBe('new'); expect(store.state.taskFilters.q).toBe('new');
  });
  it('clears conditions on a project switch and ignores an old query rejection', async () => {
    const slow = deferred<Task[]>();
    const api = createFakeApi({ getBoard: async id => id === BOARD_A.id ? BOARD_A : BOARD_B,
      listTasks: async (id, _signal, filters) => filters?.q ? slow.promise : [makeTask({ boardId: id })] });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id);
    const previous = store.applyTaskFilters({ q: 'old' }); await store.openBoard(BOARD_B.id);
    slow.reject(new ApiError({ kind: 'http', code: 'SERVICE_UNAVAILABLE', status: 503 })); await previous;
    expect(store.state.currentBoardId).toBe(BOARD_B.id); expect(store.state.taskFilters).toEqual({});
    expect(store.state.taskResults.status).toBe('idle'); expect(store.state.tasks.data[0]?.boardId).toBe(BOARD_B.id);
  });
  it('reports an edited task leaving the current filter without dropping the full snapshot', async () => {
    const task = makeTask({ priority: 'high' }); let changed = false;
    const api = createFakeApi({ listTasks: async (_id, _signal, filters) => filters?.priority && changed ? [] : [task],
      updateTask: async (_board, id, input) => { changed = true; return { ...task, id, ...input }; } });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id); await store.applyTaskFilters({ priority: 'high' });
    await store.updateTask(task.id, { ...task, priority: 'low' });
    expect(store.state.taskResults.data).toEqual([]); expect(store.state.tasks.data[0]?.priority).toBe('low');
    expect(store.state.filterNotice).toContain('已移出结果');
  });
  it('keeps a committed write successful when the follow-up query fails and never replays it', async () => {
    const task = makeTask({ priority: 'high' }); let changed = false;
    const api = createFakeApi({ listTasks: async (_id, _signal, filters) => {
      if (filters && changed) throw new ApiError({ kind: 'http', code: 'SERVICE_UNAVAILABLE', status: 503 }); return [task];
    }, updateTask: async (_board, id, input) => { changed = true; return { ...task, id, ...input }; } });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id); await store.applyTaskFilters({ priority: 'high' });
    await expect(store.updateTask(task.id, { ...task, priority: 'low' })).resolves.toMatchObject({ priority: 'low' });
    expect(store.state.taskResults.status).toBe('error'); expect(store.state.filterNotice).toContain('任务已保存');
    expect(api.calls.filter(call => call.method === 'updateTask')).toHaveLength(1);
    changed = false; await store.applyTaskFilters({ priority: 'high' }); expect(store.state.taskResults.status).toBe('ready');
  });
  it('requeries current filters on manual refresh and marks failed filtered reads stale', async () => {
    let fail = false;
    const api = createFakeApi({ listTasks: async (_id, _signal, filters) => {
      if (filters && fail) throw new ApiError({ kind: 'http', code: 'SERVICE_UNAVAILABLE', status: 503 }); return [makeTask()];
    } });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id); await store.applyTaskFilters({ q: 'task' });
    fail = true; await store.refreshBoard(); expect(store.state.refreshFailed).toBe(true); expect(store.state.taskResults.status).toBe('error');
    fail = false; await store.refreshBoard(); expect(store.state.refreshFailed).toBe(false); expect(store.state.taskFilters.q).toBe('task');
  });
  it('validates a reversed date interval before emitting a query and supports reset', async () => {
    const wrapper = mount(TaskFilterBar, { props: { filters: {}, members: { status: 'ready', data: MEMBERS, error: null }, loading: false } });
    await wrapper.find('[aria-label="截止日期从"]').setValue('2026-10-30');
    await wrapper.find('[aria-label="截止日期至"]').setValue('2026-10-28'); await wrapper.find('form').trigger('submit');
    expect(wrapper.find('[role="alert"]').text()).toContain('不能早于'); expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.find('.filter-clear').trigger('click'); expect(wrapper.emitted('apply')?.[0]).toEqual([{}]); wrapper.unmount();
  });
  it('intersects personal views with query results and shows full-project counts, not false empty on errors', async () => {
    const mine = MEMBERS[0]!; account.user = { ...mine, username: 'viewer', createdAt: 'now' };
    const tasks = [makeTask({ id: 'mine', assigneeId: mine.id, priority: 'high' }), makeTask({ id: 'other', priority: 'high' }), makeTask({ id: 'low', priority: 'low' })];
    const api = createFakeApi({ listTasks: async (_id, _signal, filters) => filters ? tasks.slice(0, 2) : tasks });
    const store = createWorkspaceStore(api); await store.openBoard(BOARD_A.id);
    store.state.health = { status: 'ready', error: null, data: { status: 'ok', features: { priority: true, filters: true, ordering: false, sharing: false } } };
    const wrapper = mountWithWorkspace(BoardWorkspace, store); await store.applyTaskFilters({ priority: 'high' }); await flushPromises();
    const mineButton = wrapper.findAll('button').find(button => button.text() === '我负责的')!; await mineButton.trigger('click');
    expect(wrapper.findAll('.task-card')).toHaveLength(1); expect(wrapper.find('.project-summary').text()).toContain('任务总数3');
    store.state.taskResults = { status: 'error', data: [], error: new ApiError({ kind: 'http', code: 'SERVICE_UNAVAILABLE', status: 503 }) }; await flushPromises();
    expect(wrapper.text()).not.toContain('没有匹配任务'); expect(wrapper.text()).not.toContain('当前项目暂无分配给你的任务'); wrapper.unmount();
  });
});
