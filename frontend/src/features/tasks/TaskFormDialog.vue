<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  STATUS_LABELS,
  TASK_STATUSES,
  normalizeTaskDescription,
  normalizeTaskTitle,
  parseAssigneeId,
  parseDueDate,
  parseTaskStatus,
  parseTaskPriority,
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  type Member,
  type Task,
  type TaskFieldInput,
  type TaskStatus,
} from '@team-plan/shared';
import { ApiError } from '../../api/client';
import { useWorkspaceStore } from '../../state/injection';
import type { Resource } from '../../state/workspace';
import { registerLeaveGuard } from '../ui/leaveGuard';
import { describeError } from '../ui/messages';
import ModalDialog from '../ui/ModalDialog.vue';

const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    /** Edit mode: snapshot loaded from the server right before opening. */
    task?: Task | null;
    members: Resource<Member[]>;
    /** Column entry point preselects that column's status. */
    initialStatus?: TaskStatus;
  }>(),
  { task: null, initialStatus: 'todo' },
);

const emit = defineEmits<{
  close: [];
  saved: [task: Task];
  'retry-members': [];
  refresh: [];
}>();

const store = useWorkspaceStore();
const priorityEnabled = computed(() => store.state.health.data?.features.priority === true);

const draft = reactive({
  title: props.task?.title ?? '',
  description: props.task?.description ?? '',
  dueDate: props.task?.dueDate ?? '',
  assigneeId: props.task?.assigneeId ?? '',
  status: (props.task?.status ?? props.initialStatus) as TaskStatus,
  priority: props.task?.priority ?? 'medium',
});

const initialSnapshot = JSON.stringify(draft);

const fieldErrors = reactive<Record<string, string>>({});
const saving = ref(false);
const errorText = ref<string | null>(null);
const taskGone = ref(false);
const discardOpen = ref(false);
const overwriteOpen = ref(false);

let discardResolve: ((allowed: boolean) => void) | null = null;
let overwriteResolve: ((allowed: boolean) => void) | null = null;

const titleInput = ref<HTMLInputElement | null>(null);
const descriptionInput = ref<HTMLTextAreaElement | null>(null);
const dueDateInput = ref<HTMLInputElement | null>(null);
const assigneeSelect = ref<HTMLSelectElement | null>(null);
const statusSelect = ref<HTMLSelectElement | null>(null);
const prioritySelect = ref<HTMLSelectElement | null>(null);
const discardKeepButton = ref<HTMLButtonElement | null>(null);

const isDirty = computed(() => JSON.stringify(draft) !== initialSnapshot);
const membersUnavailable = computed(() => props.members.status !== 'ready');
const heading = computed(() => (props.mode === 'create' ? '新建任务' : '编辑任务'));

const fieldOrder = ['title', 'description', 'dueDate', 'assigneeId', 'status', 'priority'] as const;

async function focusField(field: string): Promise<void> {
  await nextTick();
  const map: Record<string, HTMLElement | null> = {
    title: titleInput.value,
    description: descriptionInput.value,
    dueDate: dueDateInput.value,
    assigneeId: assigneeSelect.value,
    status: statusSelect.value,
    priority: prioritySelect.value,
  };
  map[field]?.focus();
}

function validate(): TaskFieldInput | null {
  for (const key of Object.keys(fieldErrors)) {
    delete fieldErrors[key];
  }

  let firstInvalid: string | null = null;
  const mark = (field: string, message: string): void => {
    fieldErrors[field] = message;
    firstInvalid ??= field;
  };

  const title = normalizeTaskTitle(draft.title);
  if (!title.ok) {
    mark('title', Object.values(title.fields)[0] ?? '标题不合法');
  }

  const description = normalizeTaskDescription(draft.description);
  if (!description.ok) {
    mark('description', Object.values(description.fields)[0] ?? '描述不合法');
  }

  const dueDate = parseDueDate(draft.dueDate === '' ? null : draft.dueDate);
  if (!dueDate.ok) {
    mark('dueDate', Object.values(dueDate.fields)[0] ?? '截止日期不合法');
  }

  const assigneeId = parseAssigneeId(draft.assigneeId === '' ? null : draft.assigneeId);
  if (!assigneeId.ok) {
    mark('assigneeId', Object.values(assigneeId.fields)[0] ?? '负责人不合法');
  }

  const status = parseTaskStatus(draft.status);
  if (!status.ok) {
    mark('status', Object.values(status.fields)[0] ?? '状态不合法');
  }
  const priority = parseTaskPriority(draft.priority);
  if (priorityEnabled.value && !priority.ok) mark('priority', '请选择高、中或低优先级');

  if (firstInvalid !== null) {
    void focusField(firstInvalid);
    return null;
  }

  return {
    title: title.ok ? title.value : '',
    description: description.ok ? description.value : '',
    dueDate: dueDate.ok ? dueDate.value : null,
    assigneeId: assigneeId.ok ? assigneeId.value : null,
    status: status.ok ? status.value : 'todo',
    ...(priorityEnabled.value && priority.ok ? { priority: priority.value } : {}),
  };
}

function askDiscard(): Promise<boolean> {
  discardOpen.value = true;
  void nextTick(() => discardKeepButton.value?.focus());
  return new Promise((resolve) => {
    discardResolve = resolve;
  });
}

function resolveDiscard(allowed: boolean): void {
  discardOpen.value = false;
  discardResolve?.(allowed);
  discardResolve = null;
}

function askOverwrite(): Promise<boolean> {
  overwriteOpen.value = true;
  return new Promise((resolve) => {
    overwriteResolve = resolve;
  });
}

function resolveOverwrite(allowed: boolean): void {
  overwriteOpen.value = false;
  overwriteResolve?.(allowed);
  overwriteResolve = null;
}

async function requestClose(): Promise<void> {
  if (saving.value) {
    return;
  }
  if (discardOpen.value) {
    resolveDiscard(false);
    return;
  }
  if (!isDirty.value) {
    emit('close');
    return;
  }
  const allowed = await askDiscard();
  if (allowed) {
    emit('close');
  }
}

async function submit(): Promise<void> {
  if (saving.value || membersUnavailable.value) {
    return;
  }

  const input = validate();
  if (input === null) {
    return;
  }

  saving.value = true;
  errorText.value = null;
  taskGone.value = false;

  try {
    if (props.mode === 'edit' && props.task !== null) {
      // Compare with the server right before saving: if the task changed after
      // this form loaded it, the user decides whether to overwrite (no lock).
      const latest = await store.fetchTask(props.task.id);
      if (latest.updatedAt !== props.task.updatedAt) {
        saving.value = false;
        const confirmed = await askOverwrite();
        if (!confirmed) {
          return;
        }
        saving.value = true;
      }
    }

    const task =
      props.mode === 'create' || props.task === null
        ? await store.createTask(input)
        : await store.updateTask(props.task.id, input);
    emit('saved', task);
    emit('close');
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR' && error.fields !== undefined) {
        for (const field of fieldOrder) {
          const message = error.fields[field];
          if (typeof message === 'string') {
            fieldErrors[field] = message;
          }
        }
        const first = fieldOrder.find((field) => fieldErrors[field] !== undefined);
        if (first !== undefined) {
          void focusField(first);
        }
      } else if (error.code === 'NOT_FOUND') {
        taskGone.value = true;
      } else {
        // Failure keeps every entered value; the user retries from here.
        errorText.value = describeError(error);
      }
    } else {
      errorText.value = describeError(error);
    }
  } finally {
    saving.value = false;
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (isDirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}

onMounted(() => {
  registerLeaveGuard(async () => {
    if (saving.value) {
      return false;
    }
    if (!isDirty.value) {
      return true;
    }
    return askDiscard();
  });
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  registerLeaveGuard(null);
  window.removeEventListener('beforeunload', onBeforeUnload);
});
</script>

<template>
  <ModalDialog
    :title="heading"
    initial-focus="#task-title"
    panel-class="modal-panel--form"
    :close-on-overlay="false"
    @close="requestClose"
  >
    <form class="task-form" @submit.prevent="submit">
      <p v-if="membersUnavailable" class="field-error" role="alert">
        负责人信息加载失败，保存已禁用。
        <button type="button" class="btn btn--outline btn--sm" @click="emit('retry-members')">
          重试
        </button>
      </p>

      <div class="form-field">
        <label class="field-label" for="task-title">标题 <span class="required">*</span></label>
        <input
          id="task-title"
          ref="titleInput"
          v-model="draft.title"
          class="input"
          type="text"
          :disabled="saving"
          :aria-invalid="fieldErrors.title !== undefined"
        />
        <p v-if="fieldErrors.title" class="field-error">{{ fieldErrors.title }}</p>
      </div>

      <div class="form-field">
        <div class="field-topline">
          <label class="field-label" for="task-description">描述</label>
          <span class="field-counter" :class="{ 'is-over': draft.description.length > 2000 }">
            {{ draft.description.length }} / 2000
          </span>
        </div>
        <textarea
          id="task-description"
          ref="descriptionInput"
          v-model="draft.description"
          class="textarea"
          :disabled="saving"
          :aria-invalid="fieldErrors.description !== undefined"
        ></textarea>
        <p v-if="fieldErrors.description" class="field-error">{{ fieldErrors.description }}</p>
      </div>

      <div class="field-grid">
        <div class="form-field">
          <label class="field-label" for="task-due-date">截止日期</label>
          <input
            id="task-due-date"
            ref="dueDateInput"
            v-model="draft.dueDate"
            class="input"
            type="date"
            :disabled="saving"
            :aria-invalid="fieldErrors.dueDate !== undefined"
          />
          <p class="field-hint">按 Asia/Shanghai 计算逾期；允许过去日期</p>
          <p v-if="fieldErrors.dueDate" class="field-error">{{ fieldErrors.dueDate }}</p>
        </div>

        <div class="form-field">
          <label class="field-label" for="task-assignee">负责人</label>
          <select
            id="task-assignee"
            ref="assigneeSelect"
            v-model="draft.assigneeId"
            class="select"
            :disabled="saving || membersUnavailable"
            :aria-invalid="fieldErrors.assigneeId !== undefined"
          >
            <option value="">未分配</option>
            <option v-for="member in members.data" :key="member.id" :value="member.id">
              {{ member.displayName }}
            </option>
          </select>
          <p v-if="fieldErrors.assigneeId" class="field-error">{{ fieldErrors.assigneeId }}</p>
        </div>
      </div>

      <div class="form-field">
        <label class="field-label" for="task-status">状态</label>
        <select
          id="task-status"
          ref="statusSelect"
          v-model="draft.status"
          class="select"
          :disabled="saving"
          :aria-invalid="fieldErrors.status !== undefined"
        >
          <option v-for="status in TASK_STATUSES" :key="status" :value="status">
            {{ STATUS_LABELS[status] }}
          </option>
        </select>
        <p v-if="fieldErrors.status" class="field-error">{{ fieldErrors.status }}</p>
      </div>

      <div v-if="priorityEnabled" class="form-field">
        <label class="field-label" for="task-priority">优先级</label>
        <select id="task-priority" ref="prioritySelect" v-model="draft.priority" class="select" :disabled="saving" :aria-invalid="fieldErrors.priority !== undefined">
          <option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ PRIORITY_LABELS[priority] }}</option>
        </select>
        <p v-if="fieldErrors.priority" class="field-error">{{ fieldErrors.priority }}</p>
      </div>
      <p v-if="errorText" class="field-error" role="alert">{{ errorText }}</p>

      <div v-if="taskGone" class="inline-confirm" role="alert">
        <p>该任务已不存在（可能已被其他浏览器删除）。请刷新看板后重试。</p>
        <button type="button" class="btn btn--outline btn--sm" @click="emit('refresh')">
          刷新看板
        </button>
      </div>

      <div v-if="overwriteOpen" class="inline-confirm" role="alertdialog" aria-label="覆盖确认">
        <p>任务在打开表单后被他人修改过，继续保存可能覆盖他人修改。</p>
        <div class="inline-confirm__actions">
          <button type="button" class="btn btn--outline btn--sm" @click="resolveOverwrite(false)">
            取消
          </button>
          <button type="button" class="btn btn--danger btn--sm" @click="resolveOverwrite(true)">
            仍然保存
          </button>
        </div>
      </div>

      <div v-if="discardOpen" class="inline-confirm" role="alertdialog" aria-label="确认丢弃修改">
        <p>有未保存的修改，确定要丢弃吗？</p>
        <div class="inline-confirm__actions">
          <button
            ref="discardKeepButton"
            type="button"
            class="btn btn--outline btn--sm"
            @click="resolveDiscard(false)"
          >
            继续编辑
          </button>
          <button type="button" class="btn btn--danger btn--sm" @click="resolveDiscard(true)">
            丢弃修改
          </button>
        </div>
      </div>

      <button type="submit" class="sr-only" tabindex="-1">提交</button>
    </form>

    <template #footer>
      <button type="button" class="btn btn--outline" :disabled="saving" @click="requestClose">
        取消
      </button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="saving || membersUnavailable"
        @click="submit"
      >
        {{ saving ? '保存中…' : '保存任务' }}
      </button>
    </template>
  </ModalDialog>
</template>
