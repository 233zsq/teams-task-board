<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BoardSidebar from '../features/boards/BoardSidebar.vue';
import CreateBoardForm from '../features/boards/CreateBoardForm.vue';
import { describeError } from '../features/ui/messages';
import { useWorkspaceStore } from '../state/injection';

/**
 * `/`: the board list workspace. With boards present the first board
 * (createdAt/id ascending) becomes the default selection; an empty database
 * shows a creation guide instead of an empty board.
 */
const store = useWorkspaceStore();
const state = store.state;
const router = useRouter();
const creating = ref(false);

onMounted(async () => {
  void store.loadMembers();
  const boards = await store.loadBoardList();
  if (boards !== null && boards.length > 0) {
    const first = boards[0];
    if (first !== undefined) {
      await router.replace(`/boards/${first.id}`);
    }
  }
});

function select(boardId: string): void {
  void router.push(`/boards/${boardId}`);
}

function created(boardId: string): void {
  void router.push(`/boards/${boardId}`);
}

function retry(): void {
  void store.loadBoardList();
}
</script>

<template>
  <div class="app-shell">
    <BoardSidebar
      :boards="state.boards.data"
      :current-board-id="null"
      :list-status="state.boards.status"
      :list-error="state.boards.error"
      :switching-disabled="creating"
      @select="select"
      @retry="retry"
      @created="created($event.id)"
      @busy="creating = $event"
    />

    <main class="app-main">
      <header class="app-topbar">
        <div class="crumbs">
          <span>工作区</span>
          <span aria-hidden="true">/</span>
          <span class="crumbs__current">团队看板</span>
        </div>
      </header>

      <div class="workspace">
        <div v-if="state.boards.status === 'loading'" class="state-panel" role="status">
          <h2 class="state-panel__title">正在加载看板</h2>
          <p class="state-panel__text">正在读取看板列表，请稍候。</p>
        </div>

        <div v-else-if="state.boards.status === 'error'" class="state-panel" role="alert">
          <h2 class="state-panel__title">看板列表读取失败</h2>
          <p class="state-panel__text">
            {{ state.boards.error === null ? '未知错误' : describeError(state.boards.error) }}
          </p>
          <button type="button" class="btn btn--primary" @click="retry">重试</button>
        </div>

        <div v-else-if="state.boards.data.length === 0" class="state-panel state-panel--guide">
          <h2 class="state-panel__title">还没有看板</h2>
          <p class="state-panel__text">
            先创建一个看板（例如“课程作业”），再在其中添加任务。看板用于把任务按主题分组。
          </p>
          <CreateBoardForm
            :disabled="creating"
            @created="created($event.id)"
            @busy="creating = $event"
          />
        </div>

        <div v-else class="state-panel" role="status">
          <h2 class="state-panel__title">正在打开看板</h2>
          <p class="state-panel__text">已读取到看板列表，正在打开第一个看板。</p>
        </div>
      </div>
    </main>
  </div>
</template>