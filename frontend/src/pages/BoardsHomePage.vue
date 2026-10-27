<script setup lang="ts">
// Placeholder shell page: replaced by the board navigation workspace in the
// TASK-009 slice. Kept minimal so the router and layout can be verified.
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
          <h2 class="state-panel__title">正在加载</h2>
          <p class="state-panel__text">正在读取看板列表，请稍候。</p>
        </div>
      </div>
    </main>
  </div>
</template>