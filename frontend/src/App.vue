<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import HealthGate from './features/health/HealthGate.vue';
import ErrorPage from './pages/ErrorPage.vue';
import { provideWorkspace } from './state/injection';
import { workspace } from './state/workspace';

/**
 * Application shell: provides the workspace store, gates startup on the health
 * check, and keeps a recoverable error page for runtime failures.
 */
provideWorkspace(workspace);

const fatalMessage = ref<string | null>(null);

function onFatal(event: Event): void {
  fatalMessage.value = (event as CustomEvent<string>).detail;
}

function reload(): void {
  window.location.reload();
}

onMounted(() => {
  window.addEventListener('app:fatal', onFatal);
});

onBeforeUnmount(() => {
  window.removeEventListener('app:fatal', onFatal);
});
</script>

<template>
  <ErrorPage v-if="fatalMessage !== null" :detail="fatalMessage" @reload="reload" />
  <HealthGate v-else>
    <RouterView />
  </HealthGate>
</template>