<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BoardSidebar from '../features/boards/BoardSidebar.vue';
import BoardWorkspace from '../features/tasks/BoardWorkspace.vue';
import { confirmLeave } from '../features/ui/leaveGuard';
import { useWorkspaceStore } from '../state/injection';

const props = defineProps<{ boardId: string }>();

const store = useWorkspaceStore();
const state = store.state;
const router = useRouter();
const creating = ref(false);

const currentName = computed(() => state.board.data?.name ?? '看板');

async function load(boardId: string): Promise<void> {
  if (state.boards.status !== 'ready') {
    void store.loadBoardList();
  }
  if (state.members.status !== 'ready') {
    void store.loadMembers();
  }
  await store.openBoard(boardId);
}

onMounted(() => {
  void load(props.boardId);
});

watch(
  () => props.boardId,
  (boardId) => {
    void load(boardId);
  },
);

async function select(boardId: string): Promise<void> {
  if (boardId === props.boardId) {
    return;
  }
  // An open draft blocks the switch until the user decides.
  if (!(await confirmLeave())) {
    return;
  }
  await router.push(`/boards/${boardId}`);
}

async function created(boardId: string): Promise<void> {
  if (!(await confirmLeave())) {
    return;
  }
  await router.push(`/boards/${boardId}`);
}

function retry(): void {
  void store.loadBoardList();
}
</script>

<template>
  <div class="app-shell">
    <BoardSidebar
      :boards="state.boards.data"
      :current-board-id="props.boardId"
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
          <span class="crumbs__current">{{ currentName }}</span>
        </div>
      </header>

      <BoardWorkspace />
    </main>
  </div>
</template>