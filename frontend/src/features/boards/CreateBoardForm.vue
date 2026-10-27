<script setup lang="ts">
import { ref } from 'vue';
import { normalizeBoardName, type Board } from '@team-plan/shared';
import { useWorkspaceStore } from '../../state/injection';
import { describeError } from '../ui/messages';

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ created: [board: Board]; busy: [creating: boolean] }>();

const store = useWorkspaceStore();
const name = ref('');
const fieldError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);

async function submit(): Promise<void> {
  if (submitting.value) {
    return;
  }

  const parsed = normalizeBoardName(name.value);
  if (!parsed.ok) {
    fieldError.value = parsed.fields.name ?? '看板名称不合法';
    submitError.value = null;
    return;
  }

  fieldError.value = null;
  submitError.value = null;
  submitting.value = true;
  emit('busy', true);

  try {
    // The name stays in the input until the server confirms the new board.
    const board = await store.createBoard(parsed.value);
    name.value = '';
    emit('created', board);
  } catch (error) {
    // Saving failure keeps the entered name so the retry is one click away.
    submitError.value = describeError(error);
  } finally {
    submitting.value = false;
    emit('busy', false);
  }
}
</script>

<template>
  <form class="create-board" @submit.prevent="submit">
    <label class="field-label sr-only" for="new-board-name">新建看板名称</label>
    <input
      id="new-board-name"
      v-model="name"
      class="input"
      type="text"
      maxlength="80"
      placeholder="新建看板名称"
      :disabled="props.disabled || submitting"
      :aria-invalid="fieldError !== null"
      @input="fieldError = null"
    />
    <button type="submit" class="btn btn--soft btn--sm" :disabled="props.disabled || submitting">
      {{ submitting ? '创建中…' : '新建看板' }}
    </button>
    <p v-if="fieldError !== null" class="field-error">{{ fieldError }}</p>
    <p v-if="submitError !== null" class="field-error">{{ submitError }}</p>
  </form>
</template>