<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ModalDialog from '../ui/ModalDialog.vue';

/**
 * Destructive confirmation used for task deletion. The default focus is the
 * cancel button, so pressing Enter without an explicit choice never deletes.
 */
defineProps<{ taskTitle: string; busy?: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();

const cancelButton = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  cancelButton.value?.focus();
});
</script>

<template>
  <ModalDialog title="删除任务" initial-focus="[data-cancel]" @close="emit('cancel')">
    <p class="confirm-text">
      确定要删除任务「{{ taskTitle }}」吗？删除后不可恢复，其他协作者刷新后也会看不到它。
    </p>
    <template #footer>
      <button
        ref="cancelButton"
        data-cancel
        type="button"
        class="btn btn--outline"
        :disabled="busy === true"
        @click="emit('cancel')"
      >
        取消
      </button>
      <button
        type="button"
        class="btn btn--danger"
        :disabled="busy === true"
        @click="emit('confirm')"
      >
        {{ busy === true ? '删除中…' : '删除任务' }}
      </button>
    </template>
  </ModalDialog>
</template>