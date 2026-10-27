<script setup lang="ts">
// Placeholder board page: replaced by the three-column workspace in the
// TASK-010 slice. Kept minimal so the route `/boards/:boardId` opens.
defineProps<{ boardId: string }>();
</script>

<template>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">T</span>
        <span>
          <span class="brand__title">团队任务协作看板</span>
          <span class="brand__subtitle">TEAM PLAN</span>
        </span>
      </div>
      <p class="sidebar-footnote">正在加载看板…</p>
    </aside>
    <main class="app-main">
      <div class="workspace">
        <div class="state-panel">
          <h2 class="state-panel__title">正在加载看板</h2>
          <p class="state-panel__text">看板 ID：{{ boardId }}</p>
        </div>
      </div>
    </main>
  </div>
</template>