<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_LABELS, type Member, type Task, type TaskStatus } from '@team-plan/shared';
import type { ApiError } from '../../api/client';
import type { Resource } from '../../state/workspace';
import { describeError } from '../ui/messages';
import TaskCard from './TaskCard.vue';

const props = defineProps<{
  status: TaskStatus;
  tasks: Task[];
  loading: boolean;
  error: ApiError | null;
  members: Resource<Member[]>;
  today: string;
}>();

const emit = defineEmits<{
  open: [taskId: string];
  create: [status: TaskStatus];
  retry: [];
}>();

const label = computed(() => STATUS_LABELS[props.status]);
</script>

<template>
  <section class="board-column" :aria-label="`${label}列`">
    <header class="board-column__head">
      <h3 class="board-column__title">
        <span class="status-dot" :class="`status-dot--${status}`" aria-hidden="true"></span>
        {{ label }}
        <span class="badge badge--soft">{{ loading ? '…' : tasks.length }}</span>
      </h3>
      <button
        type="button"
        class="icon-btn icon-btn--sm"
        :aria-label="`在${label}列新建任务`"
        :data-add-status="status"
        @click="emit('create', status)"
      >
        ＋
      </button>
    </header>

    <div class="board-column__body">
      <template v-if="loading">
        <div v-for="index in 2" :key="index" class="skeleton task-card-skeleton" aria-hidden="true">
          <span class="skeleton-line skeleton-line--wide"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line skeleton-line--short"></span>
        </div>
        <p class="sr-only" role="status">正在加载{{ label }}任务</p>
      </template>

      <div v-else-if="error !== null" class="column-state column-state--error" role="alert">
        <p>任务读取失败：{{ describeError(error) }}</p>
        <button type="button" class="btn btn--outline btn--sm" @click="emit('retry')">重试</button>
      </div>

      <p v-else-if="tasks.length === 0" class="column-state column-state--empty">
        暂无任务
      </p>

      <template v-else>
        <TaskCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
          :members="members"
          :today="today"
          @open="emit('open', $event)"
        />
      </template>
    </div>

    <button type="button" class="board-column__add" @click="emit('create', status)">
      ＋ 添加任务
    </button>
  </section>
</template>