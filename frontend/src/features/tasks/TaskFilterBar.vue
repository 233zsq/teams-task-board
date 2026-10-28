<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { PRIORITY_LABELS, TASK_PRIORITIES, parseTaskFilters, hasTaskFilters, type Member, type TaskFilters } from '@team-plan/shared';
import type { Resource } from '../../state/workspace';

const props = defineProps<{ filters: TaskFilters; members: Resource<Member[]>; loading: boolean }>();
const emit = defineEmits<{ apply: [filters: TaskFilters] }>();
const blank = () => ({ q: '', assigneeId: '', priority: '', dueFrom: '', dueTo: '' });
const draft = reactive(blank());
const error = ref('');
const fields = ref<Record<string, string>>({});
watch(() => props.filters, (filters) => { Object.assign(draft, blank(), filters); error.value = ''; fields.value = {}; }, { immediate: true, deep: true });
const activeCount = computed(() => Object.values(props.filters).filter(Boolean).length);
const pending = computed(() => {
  const parsed = parseTaskFilters(draft);
  return !parsed.ok || JSON.stringify(parsed.value) !== JSON.stringify(props.filters);
});
function submit(): void {
  const parsed = parseTaskFilters(draft);
  if (!parsed.ok) { fields.value = parsed.fields; error.value = Object.values(parsed.fields).join('；'); return; }
  error.value = ''; fields.value = {}; emit('apply', parsed.value);
}
function clear(): void { Object.assign(draft, blank()); error.value = ''; fields.value = {}; emit('apply', {}); }
</script>

<template>
  <form class="task-filter-bar" aria-label="搜索与筛选任务" :aria-busy="loading" @submit.prevent="submit">
    <div class="task-search-line"><label class="task-search-input"><span aria-hidden="true">⌕</span><span class="sr-only">搜索任务</span><input v-model="draft.q" type="search" placeholder="搜索任务标题或描述…" :aria-invalid="!!fields.q"></label><button class="btn btn--primary btn--sm" type="submit">{{ loading ? '查询中…' : '搜索 / 筛选' }}</button></div>
    <div class="task-filter-fields">
      <label>负责人<select v-model="draft.assigneeId" aria-label="筛选负责人" :disabled="members.status !== 'ready'" :aria-invalid="!!fields.assigneeId"><option value="">全部负责人</option><option value="unassigned">未分配</option><option v-for="member in members.data" :key="member.id" :value="member.id">{{ member.displayName }}</option></select></label>
      <label>优先级<select v-model="draft.priority" aria-label="筛选优先级"><option value="">全部优先级</option><option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ PRIORITY_LABELS[priority] }}</option></select></label>
      <label>截止日期从<input v-model="draft.dueFrom" type="date" aria-label="截止日期从" :aria-invalid="!!fields.dueFrom"></label>
      <label>至<input v-model="draft.dueTo" type="date" aria-label="截止日期至" :aria-invalid="!!fields.dueTo"></label>
      <button class="filter-clear" type="button" :disabled="!hasTaskFilters(filters) && !Object.values(draft).some(Boolean)" @click="clear">清空筛选</button>
    </div>
    <div class="task-filter-hint"><span v-if="activeCount" class="filter-active-count">已应用 {{ activeCount }} 项条件</span><span v-if="pending">条件已修改，点击搜索应用</span><span v-else>条件取交集 · 日期包含起止当天 · 项目进度仍显示全部任务</span></div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </form>
</template>
