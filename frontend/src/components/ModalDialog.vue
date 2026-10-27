<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let previous: HTMLElement | null = null;
onMounted(() => { previous = document.activeElement as HTMLElement; dialog.value?.showModal(); });
onUnmounted(() => { dialog.value?.close(); previous?.focus(); });
</script>

<template>
  <dialog ref="dialog" aria-labelledby="dialog-title" @cancel.prevent="!busy && emit('close')">
    <header class="dialog-header"><h2 id="dialog-title">{{ title }}</h2><button type="button" class="icon-button" aria-label="关闭弹窗" :disabled="busy" @click="emit('close')">×</button></header>
    <slot />
  </dialog>
</template>
