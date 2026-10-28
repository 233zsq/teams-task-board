<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  TASK_STATUSES,
  businessToday,
  isOverdue,
  formatBusinessTime,
  taskToFieldInput,
  type Task,
  type TaskStatus,
} from '@team-plan/shared';
import { ApiError } from '../../api/client';
import { useWorkspaceStore } from '../../state/injection';
import { confirmLeave } from '../ui/leaveGuard';
import { describeError } from '../ui/messages';
import DeleteConfirmDialog from './DeleteConfirmDialog.vue';
import TaskColumn from './TaskColumn.vue';
import TaskDetailPanel from './TaskDetailPanel.vue';
import TaskFormDialog from './TaskFormDialog.vue';
import ProjectPanel from '../projects/ProjectPanel.vue';
import { account } from '../../state/account';

const store = useWorkspaceStore();
const state = store.state;
const personalFilter = ref<'all' | 'assigned' | 'published'>('all');
const progress = computed(() => {
  const total = state.tasks.data.length;
  const done = state.tasks.data.filter((task) => task.status === 'done').length;
  return { total, done, overdue: state.tasks.data.filter((task) => isOverdue(task.dueDate, task.status, today.value)).length,
    percent: total ? Math.round(done / total * 100) : 0 };
});
const visibleTasks = computed(() => state.tasks.data.filter((task) => personalFilter.value === 'all'
  || (personalFilter.value === 'assigned' && task.assigneeId === account.user?.id)
  || (personalFilter.value === 'published' && task.createdBy?.id === account.user?.id)));
watch(() => state.currentBoardId, () => { personalFilter.value = 'all'; });

/** Overdue is derived per load/refresh, never from a background timer. */
const todayTick = ref(Date.now());
watch(
  () => state.lastRefreshedAt,
  (value) => {
    if (value !== null) {
      todayTick.value = value;
    }
  },
);
const today = computed(() => businessToday(new Date(todayTick.value)));

const selectedTaskId = ref<string | null>(null);
const selectedTask = computed(
  () => state.tasks.data.find((task) => task.id === selectedTaskId.value) ?? null,
);

type FormState = { mode: 'create'; status: TaskStatus } | { mode: 'edit'; task: Task };

const formState = ref<FormState | null>(null);
const deleteTarget = ref<Task | null>(null);
const statusBusy = ref(false);
const deleteBusy = ref(false);
const actionError = ref<string | null>(null);

const tasksByStatus = computed(() => {
  const groups: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
  for (const task of visibleTasks.value) {
    groups[task.status].push(task);
  }
  return groups;
});

const lastRefreshText = computed(() =>
  state.lastRefreshedAt === null ? null : formatBusinessTime(state.lastRefreshedAt),
);

const boardMissing = computed(
  () => state.board.status === 'error' && state.board.error?.code === 'NOT_FOUND',
);
const boardFailed = computed(
  () => state.board.status === 'error' && state.board.error?.code !== 'NOT_FOUND',
);
const columnsLoading = computed(
  () => state.board.status === 'loading' || state.tasks.status === 'loading',
);
const tasksError = computed(() =>
  state.tasks.status === 'error' ? state.tasks.error : null,
);

async function refresh(): Promise<void> {
  if (!(await confirmLeave())) {
    return;
  }
  await store.refreshBoard();
}

async function retryTasks(): Promise<void> {
  await store.refreshBoard();
}

/** A task deleted elsewhere: close the draft/detail, then reload the board. */
async function refreshAfterGone(): Promise<void> {
  formState.value = null;
  selectedTaskId.value = null;
  await store.refreshBoard();
}

function openCreate(status: TaskStatus): void {
  actionError.value = null;
  formState.value = { mode: 'create', status };
}

function openCreateDefault(): void {
  openCreate('todo');
}

async function openEdit(): Promise<void> {
  const task = selectedTask.value;
  if (task === null) {
    return;
  }

  actionError.value = null;
  try {
    // Read the latest snapshot before editing so the form starts from the
    // newest values and a deleted task is detected before any typing.
    const latest = await store.fetchTask(task.id);
    formState.value = { mode: 'edit', task: latest };
    selectedTaskId.value = null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      selectedTaskId.value = null;
      actionError.value = '该任务已不存在，可能已被删除；正在刷新看板';
      await store.refreshBoard();
    } else {
      actionError.value = describeError(error);
    }
  }
}

async function changeStatus(status: TaskStatus): Promise<void> {
  const task = selectedTask.value;
  if (task === null || task.status === status || statusBusy.value) {
    return;
  }

  statusBusy.value = true;
  actionError.value = null;

  try {
    // Status buttons send a complete PUT built from the current task.
    await store.updateTask(task.id, taskToFieldInput(task, { status }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      selectedTaskId.value = null;
      actionError.value = '该任务已不存在，可能已被删除；正在刷新看板';
      await store.refreshBoard();
    } else {
      // A failed change keeps the original status; nothing moved locally.
      actionError.value = describeError(error);
    }
  } finally {
    statusBusy.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const task = deleteTarget.value;
  if (task === null || deleteBusy.value) {
    return;
  }

  deleteBusy.value = true;
  actionError.value = null;

  const columnTasks = tasksByStatus.value[task.status];
  const index = columnTasks.findIndex((item) => item.id === task.id);
  const neighbor = columnTasks[index + 1] ?? columnTasks[index - 1] ?? null;

  try {
    await store.deleteTask(task.id);
    if (selectedTaskId.value === task.id) {
      selectedTaskId.value = null;
    }
    deleteTarget.value = null;

    await nextTick();
    const cardTarget =
      neighbor === null
        ? null
        : document.querySelector<HTMLElement>(`[data-task-id="${neighbor.id}"]`);
    if (cardTarget !== null) {
      cardTarget.focus();
    } else {
      document
        .querySelector<HTMLElement>(`[data-add-status="${task.status}"]`)
        ?.focus();
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      deleteTarget.value = null;
      actionError.value = '任务已不存在（可能已被其他浏览器删除），已更新列表';
      await store.refreshBoard();
    } else {
      // The card and the dialog stay so the user can retry or cancel.
      actionError.value = describeError(error);
    }
  } finally {
    deleteBusy.value = false;
  }
}

function closeForm(): void {
  formState.value = null;
}

function onSaved(): void {
  formState.value = null;
  todayTick.value = Date.now();
}
</script>

<template>
  <div class="workspace">
    <div v-if="actionError !== null" class="notice notice--danger" role="alert">
      <span>{{ actionError }}</span>
      <button type="button" class="btn btn--outline btn--sm" @click="refresh">刷新看板</button>
      <button
        type="button"
        class="icon-btn icon-btn--sm"
        aria-label="关闭提示"
        @click="actionError = null"
      >
        ✕
      </button>
    </div>

    <div v-if="boardMissing" class="state-panel" role="alert">
      <h2 class="state-panel__title">看板不存在</h2>
      <p class="state-panel__text">
        该看板可能已被删除，或者链接中的看板 ID 无效。这里不会自动切换到其他看板。
      </p>
      <RouterLink class="btn btn--primary" to="/">返回看板列表</RouterLink>
    </div>

    <div v-else-if="boardFailed" class="state-panel" role="alert">
      <h2 class="state-panel__title">看板读取失败</h2>
      <p class="state-panel__text">
        {{ state.board.error === null ? '未知错误' : describeError(state.board.error) }}
      </p>
      <button type="button" class="btn btn--primary" @click="refresh">重试</button>
    </div>

    <template v-else>
      <header class="board-header">
        <div class="board-header__meta">
          <h1 class="board-header__title">
            {{ state.board.data?.name ?? '正在加载看板…' }}
          </h1>
          <div class="board-header__subtitle">
            <span v-if="state.board.status === 'ready'">
              {{ state.tasks.data.length }} 个任务
            </span>
            <span v-if="state.refreshing" class="refresh-note">正在刷新…</span>
            <span
              v-else-if="lastRefreshText !== null"
              class="refresh-note"
              :class="{ 'is-stale': state.refreshFailed }"
            >
              最后刷新 {{ lastRefreshText
              }}<template v-if="state.refreshFailed"> · 刷新失败，数据可能已过期</template>
            </span>
            <span v-if="state.members.status === 'error'" class="text-danger">
              负责人信息不可用（成员读取失败，可刷新重试）
            </span>
          </div>
        </div>
        <div class="board-header__actions">
          <button
            type="button"
            class="btn btn--outline"
            :disabled="state.refreshing || state.board.status !== 'ready'"
            @click="refresh"
          >
            {{ state.refreshing ? '刷新中…' : '刷新看板' }}
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="state.board.status !== 'ready'"
            @click="openCreateDefault"
          >
            ＋ 新建任务
          </button>
        </div>
      </header>

      <template v-if="account.user && state.board.status === 'ready' && state.board.data">
        <ProjectPanel :board="state.board.data" />
        <div class="project-summary" aria-label="项目进度">
          <div><span>任务总数</span><strong>{{ progress.total }}</strong></div><div><span>已完成</span><strong>{{ progress.done }}</strong></div><div><span>已逾期</span><strong :class="{ 'text-danger': progress.overdue > 0 }">{{ progress.overdue }}</strong></div><div class="project-completion"><span>完成进度 <strong>{{ progress.percent }}%</strong></span><progress :value="progress.done" :max="progress.total || 1">{{ progress.percent }}%</progress></div>
        </div>
        <div class="personal-filter" role="group" aria-label="任务视图">
          <button :class="{ 'is-active': personalFilter === 'all' }" :aria-pressed="personalFilter === 'all'" @click="personalFilter = 'all'">全部任务</button>
          <button :class="{ 'is-active': personalFilter === 'assigned' }" :aria-pressed="personalFilter === 'assigned'" @click="personalFilter = 'assigned'">我负责的</button>
          <button :class="{ 'is-active': personalFilter === 'published' }" :aria-pressed="personalFilter === 'published'" @click="personalFilter = 'published'">我发布的</button>
          <span>当前项目 · {{ visibleTasks.length }} 项</span>
        </div>
        <p v-if="personalFilter !== 'all' && !visibleTasks.length" class="project-empty" role="status">当前项目暂无{{ personalFilter === 'assigned' ? '分配给你的' : '你发布的' }}任务</p>
      </template>

      <p class="scroll-hint" aria-hidden="true">← 左右滑动查看三列 →</p>

      <div class="board-columns">
        <TaskColumn
          v-for="status in TASK_STATUSES"
          :key="status"
          :status="status"
          :tasks="tasksByStatus[status]"
          :loading="columnsLoading"
          :error="tasksError"
          :members="state.members"
          :today="today"
          @open="selectedTaskId = $event"
          @create="openCreate"
          @retry="retryTasks"
        />
      </div>
    </template>

    <TaskDetailPanel
      v-if="selectedTask !== null"
      :task="selectedTask"
      :members="state.members"
      :today="today"
      :busy="statusBusy"
      @close="selectedTaskId = null"
      @edit="openEdit"
      @delete="deleteTarget = selectedTask"
      @change-status="changeStatus"
    />

    <DeleteConfirmDialog
      v-if="deleteTarget !== null"
      :task-title="deleteTarget.title"
      :busy="deleteBusy"
      @cancel="deleteTarget = null"
      @confirm="confirmDelete"
    />

    <TaskFormDialog
      v-if="formState !== null"
      :mode="formState.mode"
      :task="formState.mode === 'edit' ? formState.task : null"
      :initial-status="formState.mode === 'create' ? formState.status : 'todo'"
      :members="state.members"
      @close="closeForm"
      @saved="onSaved"
      @retry-members="store.loadMembers()"
      @refresh="refreshAfterGone"
    />
  </div>
</template>
