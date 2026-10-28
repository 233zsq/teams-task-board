<script setup lang="ts">
import { computed } from 'vue';
import { formatBusinessDateTime, type Board } from '@team-plan/shared';
import type { ResourceStatus } from '../../state/workspace';
import { describeError } from '../ui/messages';
import CreateBoardForm from './CreateBoardForm.vue';
import type { ApiError } from '../../api/client';
import { account } from '../../state/account';

const props = defineProps<{
  boards: Board[];
  currentBoardId: string | null;
  listStatus: ResourceStatus;
  listError: ApiError | null;
  /** While a board is being created, switching boards is disabled. */
  switchingDisabled?: boolean;
}>();

const emit = defineEmits<{
  select: [boardId: string];
  retry: [];
  created: [board: Board];
  busy: [creating: boolean];
}>();

const sortedBoards = computed(() =>
  [...props.boards].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt < right.createdAt ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }),
);

function createdAtText(board: Board): string {
  // Business time zone, minute precision, so same-name boards stay distinct.
  return formatBusinessDateTime(board.createdAt);
}

function select(boardId: string): void {
  if (props.switchingDisabled === true) {
    return;
  }
  emit('select', boardId);
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="brand">
      <span class="brand__mark" aria-hidden="true">T</span>
      <span>
        <span class="brand__title">团队任务协作看板</span>
        <span class="brand__subtitle">TEAM PLAN</span>
      </span>
    </div>

    <section class="sidebar-section" aria-labelledby="board-list-heading">
      <div class="sidebar-section__head">
        <h2 id="board-list-heading">我的看板</h2>
        <span v-if="listStatus === 'ready'" class="badge badge--soft">{{ boards.length }}</span>
      </div>

      <p v-if="listStatus === 'loading'" class="sidebar-footnote" role="status">
        正在读取看板列表…
      </p>

      <div v-else-if="listStatus === 'error'" class="sidebar-error" role="alert">
        <p>{{ listError === null ? '看板列表读取失败' : describeError(listError) }}</p>
        <button type="button" class="btn btn--outline btn--sm" @click="emit('retry')">
          重试
        </button>
      </div>

      <ul v-else class="board-nav-list">
        <li v-for="board in sortedBoards" :key="board.id">
          <button
            type="button"
            class="board-nav-item"
            :class="{ 'is-active': board.id === currentBoardId }"
            :aria-current="board.id === currentBoardId ? 'true' : undefined"
            :disabled="switchingDisabled === true"
            @click="select(board.id)"
          >
            <span class="board-nav-item__meta">
              <span class="board-nav-item__name">{{ board.name }}</span>
              <span class="board-nav-item__time">创建于 {{ createdAtText(board) }}</span>
              <span v-if="board.owner" class="board-nav-item__time">{{ board.role === 'owner' ? '我负责的项目' : `负责人 · ${board.owner.displayName}` }}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section class="sidebar-create" aria-label="新建看板">
      <CreateBoardForm
        input-id="new-board-sidebar-name"
        :disabled="switchingDisabled === true"
        @created="emit('created', $event)"
        @busy="emit('busy', $event)"
      />
    </section>

    <p class="sidebar-footnote">
      {{ account.user ? '这里只显示你参与的项目。请负责人按用户名添加伙伴，通过“刷新看板”读取他人改动。' : '成员 A～D 由数据库预置，仅作为任务负责人，不是登录账号；多个浏览器共享同一份数据，通过“刷新看板”读取他人改动。' }}
    </p>
  </aside>
</template>
