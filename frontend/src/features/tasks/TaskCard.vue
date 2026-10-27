<script setup lang="ts">
import { computed } from 'vue';
import {
  STATUS_LABELS,
  isOverdue,
  type Member,
  type Task,
} from '@team-plan/shared';
import type { Resource } from '../../state/workspace';
import { assigneeName } from './memberDisplay';

const props = defineProps<{
  task: Task;
  members: Resource<Member[]>;
  /** Business date (Asia/Shanghai) used for the overdue marker. */
  today: string;
}>();

const emit = defineEmits<{ open: [taskId: string] }>();

const overdue = computed(() =>
  isOverdue(props.task.dueDate, props.task.status, props.today),
);
const assignee = computed(() => assigneeName(props.task, props.members));
const dueText = computed(() => props.task.dueDate ?? '未设置');

const label = computed(
  () =>
    `${props.task.title}，状态 ${STATUS_LABELS[props.task.status]}，负责人 ${assignee.value}，截止日期 ${dueText.value}${overdue.value ? '，已逾期' : ''}`,
);
</script>

<template>
  <button
    type="button"
    class="task-card"
    :class="{ 'is-overdue': overdue }"
    :data-task-id="task.id"
    :aria-label="label"
    @click="emit('open', task.id)"
  >
    <h4 class="task-card__title">{{ task.title }}</h4>
    <p v-if="task.description !== ''" class="task-card__description">
      {{ task.description }}
    </p>
    <div class="task-card__meta">
      <span class="chip chip--member">{{ assignee }}</span>
      <span class="chip" :class="overdue ? 'chip--danger' : 'chip--muted'">
        截止 {{ dueText }}
      </span>
      <span v-if="overdue" class="chip chip--danger">⚠ 逾期</span>
      <span class="chip chip--status">{{ STATUS_LABELS[task.status] }}</span>
    </div>
  </button>
</template>