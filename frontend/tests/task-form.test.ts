import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Task } from '@team-plan/shared';
import TaskFormDialog from '../src/features/tasks/TaskFormDialog.vue';
import { ApiError } from '../src/api/client';
import { createWorkspaceStore } from '../src/state/workspace';
import {
  BOARD_A,
  MEMBERS,
  createFakeApi,
  deferred,
  makeTask,
  mountWithWorkspace,
} from './helpers/test-context';

function setup(options: {
  api?: ReturnType<typeof createFakeApi>;
  mode?: 'create' | 'edit';
  task?: Task | null;
  membersStatus?: 'ready' | 'error';
  overwriteRisk?: boolean;
} = {}): {
  api: ReturnType<typeof createFakeApi>;
  store: ReturnType<typeof createWorkspaceStore>;
  wrapper: ReturnType<typeof mountWithWorkspace>;
} {
  const api = options.api ?? createFakeApi();
  const store = createWorkspaceStore(api);
  store.state.currentBoardId = BOARD_A.id;
  store.state.members = {
    status: options.membersStatus ?? 'ready',
    data: options.membersStatus === 'error' ? [] : MEMBERS,
    error:
      options.membersStatus === 'error'
        ? new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' })
        : null,
  };

  const wrapper = mountWithWorkspace(TaskFormDialog, store, {
    props: {
      mode: options.mode ?? 'create',
      task: options.task ?? null,
      overwriteRisk: options.overwriteRisk ?? false,
      members: store.state.members,
    },
    attachTo: document.body,
  });

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

describe('task form', () => {
  it('blocks submission on client validation and focuses the first error', async () => {
    const { api, wrapper } = setup();

    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('标题不能为空');
    expect(api.calls.filter((call) => call.method === 'createTask')).toHaveLength(0);
    expect(document.activeElement?.id).toBe('task-title');
  });

  it('creates a title-only task with the contract defaults', async () => {
    const { api, wrapper } = setup();

    await wrapper.find('#task-title').setValue('  只写标题  ');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'createTask')?.args).toEqual([
      BOARD_A.id,
      {
        title: '只写标题',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
      },
    ]);
    expect(wrapper.emitted('saved')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('sends the selected member, date and status', async () => {
    const { api, wrapper } = setup();

    await wrapper.find('#task-title').setValue('联调任务');
    await wrapper.find('#task-description').setValue('第一行\n第二行');
    await wrapper.find('#task-due-date').setValue('2026-10-23');
    await wrapper.find('#task-assignee').setValue(MEMBERS[1]!.id);
    await wrapper.find('#task-status').setValue('doing');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'createTask')?.args[1]).toEqual({
      title: '联调任务',
      description: '第一行\n第二行',
      dueDate: '2026-10-23',
      assigneeId: MEMBERS[1]!.id,
      status: 'doing',
    });
  });

  it('keeps the input and shows server field errors on 422', async () => {
    const api = createFakeApi({
      createTask: async () => {
        throw new ApiError({
          kind: 'http',
          status: 422,
          code: 'VALIDATION_ERROR',
          fields: { title: '标题不能超过 100 个字符' },
        });
      },
    });
    const { wrapper } = setup({ api });

    await wrapper.find('#task-title').setValue('很长的标题');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('标题不能超过 100 个字符');
    expect((wrapper.find('#task-title').element as HTMLInputElement).value).toBe('很长的标题');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('keeps the draft and explains the verification step on other failures', async () => {
    const api = createFakeApi({
      createTask: async () => {
        throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
      },
    });
    const { wrapper } = setup({ api });

    await wrapper.find('#task-title').setValue('待重试任务');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('服务暂不可用，请稍后重试');
    expect((wrapper.find('#task-title').element as HTMLInputElement).value).toBe('待重试任务');
  });

  it('submits only once while saving', async () => {
    const pending = deferred<Task>();
    const api = createFakeApi({ createTask: async () => pending.promise });
    const { wrapper } = setup({ api });

    await wrapper.find('#task-title').setValue('锁任务');
    const save = buttonByText(wrapper, '保存任务');
    void save.trigger('click');
    void save.trigger('click');
    await flushPromises();

    expect(api.calls.filter((call) => call.method === 'createTask')).toHaveLength(1);

    pending.resolve(makeTask());
    await flushPromises();
  });

  it('disables saving and offers a retry when members failed to load', async () => {
    const { wrapper } = setup({ membersStatus: 'error' });

    expect(wrapper.text()).toContain('负责人信息加载失败，保存已禁用');
    const save = buttonByText(wrapper, '保存任务');
    expect(save.attributes('disabled')).toBeDefined();
    expect(wrapper.find('#task-assignee').attributes('disabled')).toBeDefined();

    await buttonByText(wrapper, '重试').trigger('click');
    expect(wrapper.emitted('retry-members')).toHaveLength(1);
  });

  it('asks before discarding a dirty draft when closing', async () => {
    const { api, wrapper } = setup();

    await wrapper.find('#task-title').setValue('未保存的修改');
    await buttonByText(wrapper, '取消').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('有未保存的修改');

    await buttonByText(wrapper, '继续编辑').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect((wrapper.find('#task-title').element as HTMLInputElement).value).toBe('未保存的修改');

    await buttonByText(wrapper, '取消').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '丢弃修改').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(api.calls.filter((call) => call.method === 'createTask')).toHaveLength(0);
  });

  it('closes a clean draft without a discard prompt', async () => {
    const { wrapper } = setup();

    await buttonByText(wrapper, '取消').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('有未保存的修改');
  });

  it('warns about overwriting and can cancel before the PUT', async () => {
    const task = makeTask({ id: 't1', title: '旧标题' });
    const { api, wrapper } = setup({ mode: 'edit', task, overwriteRisk: true });

    await wrapper.find('#task-title').setValue('新标题');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('可能覆盖他人修改');
    await buttonByText(wrapper, '取消').trigger('click');
    await flushPromises();
    expect(api.calls.filter((call) => call.method === 'updateTask')).toHaveLength(0);

    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '仍然保存').trigger('click');
    await flushPromises();

    expect(api.calls.find((call) => call.method === 'updateTask')?.args[1]).toBe('t1');
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });

  it('tells the user when the edited task was deleted elsewhere', async () => {
    const task = makeTask({ id: 't1' });
    const api = createFakeApi({
      updateTask: async () => {
        throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
      },
    });
    const { wrapper } = setup({ api, mode: 'edit', task });

    await wrapper.find('#task-title').setValue('改名');
    await buttonByText(wrapper, '保存任务').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('该任务已不存在');
    await buttonByText(wrapper, '刷新看板').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });
});