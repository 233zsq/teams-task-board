<script setup lang="ts">
import { computed } from 'vue';
import {
  STATUS_LABELS,
  TASK_STATUSES,
  formatBusinessDateTime,
  isOverdue,
  type Member,
  type Task,
  type TaskStatus,
} from '@team-plan/shared';
import type { Resource } from '../../state/workspace';
import ModalDialog from '../ui/ModalDialog.vue';
import { assigneeName } from './memberDisplay';

const props = defineProps<{
  task: Task;
  members: Resource<Member[]>;
  today: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  edit: [];
  delete: [];
  'change-status': [status: TaskStatus];
}>();

const assignee = computed(() => assigneeName(props.task, props.members));
const overdue = computed(() =>
  isOverdue(props.task.dueDate, props.task.status, props.today),
);
const createdAtText = computed(() => formatBusinessDateTime(props.task.createdAt));
const updatedAtText = computed(() => formatBusinessDateTime(props.task.updatedAt));
</script>

<template>
  <ModalDialog title="任务详情" panel-class="modal-panel--detail" @close="emit('close')">
    <div class="detail">
      <h3 class="detail__title">{{ task.title }}</h3>

      <p class="detail__description">
        {{ task.description === '' ? '（无描述）' : task.description }}
      </p>

      <dl class="detail__grid">
        <div v-if="'createdBy' in task"><dt>发布者</dt><dd>{{ task.createdBy?.displayName ?? '历史任务（发布者未知）' }}</dd></div>
        <div>
          <dt>负责人</dt>
          <dd>{{ assignee }}</dd>
        </div>
        <div>
          <dt>截止日期</dt>
          <dd>
            {{ task.dueDate ?? '未设置' }}
            <span v-if="overdue" class="chip chip--danger">⚠ 逾期</span>
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{{ createdAtText }}</dd>
        </div>
        <div>
          <dt>最后更新</dt>
          <dd>{{ updatedAtText }}</dd>
        </div>
      </dl>

      <div class="detail__status">
        <span class="detail__label">状态</span>
        <div class="segmented" role="group" aria-label="修改任务状态">
          <button
            v-for="status in TASK_STATUSES"
            :key="status"
            type="button"
            class="segmented__item"
            :class="{ 'is-active': task.status === status }"
            :aria-pressed="task.status === status"
            :disabled="busy"
            @click="emit('change-status', status)"
          >
            {{ STATUS_LABELS[status] }}
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn btn--outline" :disabled="busy" @click="emit('edit')">
        编辑
      </button>
      <button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="emit('delete')">
        删除
      </button>
    </template>
  </ModalDialog>
</template>
