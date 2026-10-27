<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ErrorPage from './pages/ErrorPage.vue';

/**
 * Application shell: keeps a recoverable error page for runtime failures
 * (render errors, unhandled promise rejections) instead of a blank screen.
 */
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
  <ErrorPage
    v-if="fatalMessage !== null"
    :detail="fatalMessage"
    @reload="reload"
  />
  <RouterView v-else />
</template>