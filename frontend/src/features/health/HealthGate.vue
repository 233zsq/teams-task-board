<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useWorkspaceStore } from '../../state/injection';
import { describeError } from '../ui/messages';

/**
 * Startup health gate: 503/network failure blocks the app with a retry action
 * instead of rendering an empty workspace. The health feature flags are the
 * server's; the P0 build hides unsupported extension UI and asks for a refresh.
 */
const store = useWorkspaceStore();
const state = store.state;

onMounted(() => {
  void store.checkHealth();
});

const blocked = computed(() => state.health.status === 'error');
const ready = computed(() => state.health.status === 'ready');

const featureNotice = computed(() => {
  const features = state.health.data?.features;
  if (features === undefined) {
    return null;
  }
  return features.ordering || features.sharing
    ? '服务端启用了扩展功能，当前页面未包含对应界面；请刷新页面获取最新前端。'
    : null;
});
</script>

<template>
  <div v-if="blocked" class="boot-screen" role="alert">
    <div class="state-panel state-panel--blocking">
      <h1 class="state-panel__title">暂时无法连接服务</h1>
      <p class="state-panel__text">
        健康检查失败：{{
          state.health.error === null ? '未知错误' : describeError(state.health.error)
        }}。请确认后端已启动、数据库已完成初始化，然后重试。
      </p>
      <button type="button" class="btn btn--primary" @click="store.checkHealth()">
        重新检查
      </button>
    </div>
  </div>

  <template v-else-if="ready">
    <p v-if="featureNotice !== null" class="feature-notice" role="status">
      {{ featureNotice }}
    </p>
    <slot />
  </template>

  <div v-else class="boot-screen" role="status">正在连接服务…</div>
</template>
