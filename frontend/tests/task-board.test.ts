import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  businessToday,
  formatBusinessDateTime,
  type Task,
} from '@team-plan/shared';
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

/** Shift a YYYY-MM-DD string by whole days (test data only). */
function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

function prepareStore(
  tasks: Task[],
  options: {
    membersStatus?: 'ready' | 'error';
    tasksStatus?: 'ready' | 'loading' | 'error';
    boardError?: ApiError;
  } = {},
): { store: ReturnType<typeof createWorkspaceStore>; api: ReturnType<typeof createFakeApi> } {
  const api = createFakeApi({
    listTasks: async () => tasks,
    getBoard: async () => BOARD_A,
  });
  const store = createWorkspaceStore(api);

  store.state.currentBoardId = BOARD_A.id;
  store.state.boards = { status: 'ready', data: [BOARD_A], error: null };
  store.state.members = {
    status: options.membersStatus ?? 'ready',
    data: options.membersStatus === 'error' ? [] : MEMBERS,
    error:
      options.membersStatus === 'error'
        ? new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' })
        : null,
  };
  store.state.board = options.boardError !== undefined
    ? { status: 'error', data: null, error: options.boardError }
    : { status: 'ready', data: BOARD_A, error: null };
  store.state.tasks = {
    status: options.tasksStatus ?? 'ready',
    data: options.tasksStatus === 'loading' ? [] : tasks,
    error: null,
  };
  store.state.lastRefreshedAt = Date.now();

  return { store, api };
}

describe('three-column board', () => {
  it('groups tasks into the three status columns with counts', () => {
    const tasks = [
      makeTask({ id: 't1', title: '待办任务', status: 'todo' }),
      makeTask({ id: 't2', title: '进行中任务', status: 'doing' }),
      makeTask({ id: 't3', title: '已完成任务', status: 'done' }),
      makeTask({ id: 't4', title: '第二个待办', status: 'todo' }),
    ];
    const { store } = prepareStore(tasks);
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    const columns = wrapper.findAll('.board-column');
    expect(columns).toHaveLength(3);
    expect(columns[0]!.text()).toContain('待办');
    expect(columns[0]!.text()).toContain('2');
    expect(columns[1]!.text()).toContain('进行中');
    expect(columns[2]!.text()).toContain('已完成');
  });

  it('shows assignee, due date and overdue text on cards', () => {
    const today = businessToday(new Date());
    const overdueDate = shiftDate(today, -1);
    const tasks = [
      makeTask({
        id: 't1',
        title: '逾期任务',
        status: 'todo',
        assigneeId: MEMBERS[1]!.id,
        dueDate: overdueDate,
      }),
      makeTask({ id: 't2', title: '无日期任务', status: 'todo', dueDate: null }),
    ];
    const { store } = prepareStore(tasks);
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    const overdueCard = wrapper.find('[data-task-id="t1"]');
    expect(overdueCard.text()).toContain('成员 B');
    expect(overdueCard.text()).toContain(`截止 ${overdueDate}`);
    expect(overdueCard.text()).toContain('逾期');
    expect(overdueCard.classes()).toContain('is-overdue');

    const plainCard = wrapper.find('[data-task-id="t2"]');
    expect(plainCard.text()).toContain('未分配');
    expect(plainCard.text()).toContain('截止 未设置');
    expect(plainCard.classes()).not.toContain('is-overdue');
  });

  it('shows "负责人信息不可用" instead of "未分配" when members failed', () => {
    const tasks = [
      makeTask({ id: 't1', title: '有负责人', assigneeId: MEMBERS[0]!.id }),
      makeTask({ id: 't2', title: '确实未分配' }),
    ];
    const { store } = prepareStore(tasks, { membersStatus: 'error' });
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    expect(wrapper.find('[data-task-id="t1"]').text()).toContain('负责人信息不可用');
    expect(wrapper.find('[data-task-id="t2"]').text()).toContain('未分配');
    expect(wrapper.text()).toContain('负责人信息不可用（成员读取失败，可刷新重试）');
  });

  it('shows skeletons while loading instead of an empty state', () => {
    const { store } = prepareStore([], { tasksStatus: 'loading' });
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    expect(wrapper.findAll('.task-card-skeleton')).toHaveLength(6);
    expect(wrapper.text()).not.toContain('暂无任务');
  });

  it('distinguishes an empty board from a failed task read', async () => {
    const empty = prepareStore([]);
    const emptyWrapper = mountWithWorkspace(BoardWorkspace, empty.store);
    expect(emptyWrapper.text()).toContain('暂无任务');

    const failing = prepareStore([]);
    failing.store.state.tasks = {
      status: 'error',
      data: [],
      error: new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' }),
    };
    const failingWrapper = mountWithWorkspace(BoardWorkspace, failing.store);
    expect(failingWrapper.text()).toContain('任务读取失败');
    expect(failingWrapper.text()).not.toContain('暂无任务');

    const retry = failingWrapper.findAll('button').find((button) => button.text() === '重试');
    await retry!.trigger('click');
    await flushPromises();
    expect(failing.api.calls.filter((call) => call.method === 'getBoard').length).toBe(1);
  });

  it('shows the board-not-found panel without columns or fallback data', () => {
    const { store } = prepareStore([], {
      boardError: new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' }),
    });
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    expect(wrapper.text()).toContain('看板不存在');
    expect(wrapper.text()).toContain('返回看板列表');
    expect(wrapper.findAll('.board-column')).toHaveLength(0);
  });

  it('opens the detail with full fields and business-zone timestamps', async () => {
    const task = makeTask({
      id: 't1',
      title: '详情任务',
      description: '第一行\n第二行',
      dueDate: '2026-10-23',
      assigneeId: MEMBERS[2]!.id,
      status: 'doing',
    });
    const { store } = prepareStore([task]);
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    await wrapper.find('[data-task-id="t1"]').trigger('click');

    const detail = wrapper.find('[role="dialog"]');
    expect(detail.text()).toContain('详情任务');
    expect(detail.text()).toContain('第一行');
    expect(detail.text()).toContain('成员 C');
    expect(detail.text()).toContain('2026-10-23');
    expect(detail.text()).toContain(formatBusinessDateTime(task.createdAt));
    expect(detail.text()).toContain(formatBusinessDateTime(task.updatedAt));
    expect(detail.text()).toContain('已完成');
  });

  it('keeps long titles wrapping instead of breaking the layout contract', () => {
    const task = makeTask({ id: 't1', title: '超长标题'.repeat(40) });
    const { store } = prepareStore([task]);
    const wrapper = mountWithWorkspace(BoardWorkspace, store);

    const card = wrapper.find('[data-task-id="t1"] .task-card__title');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('超长标题');
  });
});