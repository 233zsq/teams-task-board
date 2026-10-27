<script setup lang="ts">
import { reactive, watch, nextTick, ref } from 'vue';
import { TASK_STATUSES, STATUS_LABELS, validateTaskInput, type Member, type TaskDraft, type TaskStatus } from '@team-plan/shared';
const props = defineProps<{ members: Member[]; membersError: string; saving: boolean; fields: Record<string, string>; error: string; initialStatus: TaskStatus; uncertain: boolean }>();
const emit = defineEmits<{ save: [draft: TaskDraft]; cancel: []; dirty: [value: boolean]; retryMembers: []; verify: [] }>();
const draft = reactive({ title: '', description: '', dueDate: '', assigneeId: '', status: props.initialStatus });
const initial = JSON.stringify(draft);
const errors = ref<Record<string, string>>({});
const form = ref<HTMLFormElement>();
watch(draft, () => emit('dirty', JSON.stringify(draft) !== initial));
async function focusError() { await nextTick(); form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
watch(() => props.fields, () => { errors.value = props.fields; void focusError(); });
async function submit() {
  if (props.saving || props.membersError || props.uncertain) return;
  const input: TaskDraft = { ...draft, dueDate: draft.dueDate || null, assigneeId: draft.assigneeId || null };
  errors.value = validateTaskInput(input as unknown as Record<string, unknown>);
  if (Object.keys(errors.value).length) { await focusError(); return; }
  emit('save', input);
}
</script>

<template>
  <form ref="form" novalidate @submit.prevent="submit">
    <fieldset :disabled="saving">
      <label for="task-title">任务标题 <span class="required">*</span></label>
      <input id="task-title" v-model="draft.title" autofocus :aria-invalid="!!errors.title" aria-describedby="title-error" placeholder="例如：完成接口联调">
      <small id="title-error" class="field-error">{{ errors.title }}</small>
      <label for="task-description">任务描述</label>
      <textarea id="task-description" v-model="draft.description" rows="5" :aria-invalid="!!errors.description" aria-describedby="description-error" placeholder="补充目标、步骤或验收条件" />
      <small id="description-error" class="field-error">{{ errors.description }}</small>
      <div class="form-grid">
        <div><label for="task-assignee">负责人</label><select id="task-assignee" v-model="draft.assigneeId" :disabled="!!membersError" :aria-invalid="!!errors.assigneeId" aria-describedby="assignee-error"><option value="">未分配</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.displayName }}</option></select><small id="assignee-error" class="field-error">{{ errors.assigneeId }}</small></div>
        <div><label for="task-date">截止日期</label><input id="task-date" v-model="draft.dueDate" type="date" :aria-invalid="!!errors.dueDate" aria-describedby="date-error"><small id="date-error" class="field-error">{{ errors.dueDate }}</small></div>
      </div>
      <label for="task-status">初始状态</label><select id="task-status" v-model="draft.status" :aria-invalid="!!errors.status"><option v-for="status in TASK_STATUSES" :key="status" :value="status">{{ STATUS_LABELS[status] }}</option></select><small class="field-error">{{ errors.status }}</small>
    </fieldset>
    <div v-if="membersError" class="notice error" role="alert">负责人信息不可用，暂不能保存。<button type="button" :disabled="saving" @click="emit('retryMembers')">重试成员读取</button></div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div v-if="uncertain" class="notice">创建结果尚不确定。请先查证列表，确认未创建后再决定是否重试。<button type="button" :disabled="saving" @click="emit('verify')">刷新查证</button></div>
    <footer class="dialog-actions"><button type="button" class="secondary" :disabled="saving" @click="emit('cancel')">取消</button><button class="primary" :disabled="saving || !!membersError || uncertain">{{ saving ? '正在保存…' : '创建任务' }}</button></footer>
  </form>
</template>
