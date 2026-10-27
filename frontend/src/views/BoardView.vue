<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { STATUS_LABELS, TASK_STATUSES, validateBoardName, type Task, type TaskDraft, type TaskStatus } from '@team-plan/shared';
import { API_KEY, asRequestError } from '../api/service';
import { useWorkspace } from '../composables/useWorkspace';
import { formatTimestamp } from '../lib/dates';
import ModalDialog from '../components/ModalDialog.vue';
import TaskForm from '../components/TaskForm.vue';

const api = inject(API_KEY)!;
const route = useRoute(), router = useRouter();
const ws = useWorkspace(api);
const { boards, members, tasks, board, loading, refreshing, stale, error, membersError, boardsError, lastRefresh } = ws;
const modal = ref<'board' | 'task' | 'detail' | null>(null);
const saving = ref(false), dirty = ref(false), uncertain = ref(false);
const name = ref(''), nameError = ref(''), saveError = ref(''), fields = ref<Record<string, string>>({});
const initialStatus = ref<TaskStatus>('todo');
const detail = ref<Task | null>(null), detailLoading = ref(false), detailError = ref('');
const detailId = ref('');
let detailGeneration = 0;
let pendingTask: TaskDraft | null = null;
const columns = computed(() => TASK_STATUSES.map(status => ({ status, tasks: tasks.value.filter(t => t.status === status) })));
const complete = computed(() => tasks.value.filter(t => t.status === 'done').length);
function assignee(task: Task) {
  if (task.assigneeId === null) return '未分配';
  return membersError.value ? '负责人信息不可用' : members.value.find(m => m.id === task.assigneeId)?.displayName ?? '负责人信息不可用';
}
function clearDialog() {
  modal.value = null; dirty.value = false; uncertain.value = false; saveError.value = ''; fields.value = {};
  ++detailGeneration; detail.value = null; detailLoading.value = false;
}
function canLeave() {
  if (saving.value) return false;
  if (dirty.value && !window.confirm('有未保存的内容，确定丢弃吗？')) return false;
  clearDialog(); return true;
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ''; }
}
window.addEventListener('beforeunload', beforeUnload);
onUnmounted(() => { ws.dispose(); ++detailGeneration; window.removeEventListener('beforeunload', beforeUnload); });
watch(() => route.path, async () => {
  clearDialog();
  if (route.name === 'not-found') return;
  const id = typeof route.params.boardId === 'string' ? route.params.boardId : undefined;
  const selected = await ws.load(id);
  if (!id && selected && route.path === '/') await router.replace(`/boards/${selected}`);
}, { immediate: true });
async function refresh(preserveDialog = false) {
  if (saving.value || refreshing.value) return;
  if (!preserveDialog && !canLeave()) return;
  await ws.load(typeof route.params.boardId === 'string' ? route.params.boardId : undefined, !!board.value);
}
function openBoard() { clearDialog(); name.value = ''; nameError.value = ''; modal.value = 'board'; }
function openTask(status: TaskStatus = 'todo') { clearDialog(); initialStatus.value = status; pendingTask = null; modal.value = 'task'; }
function onNameInput() { dirty.value = !!name.value; nameError.value = ''; }
async function createBoard() {
  if (saving.value || uncertain.value) return;
  nameError.value = validateBoardName(name.value) ?? '';
  if (nameError.value) { await nextTick(); document.querySelector<HTMLInputElement>('#board-name')?.focus(); return; }
  saving.value = true; saveError.value = '';
  let createdId: string | undefined;
  try {
    const created = await api.createBoard({ name: name.value.trim() });
    createdId = created.id; clearDialog();
  } catch (e) {
    const failure = asRequestError(e); saveError.value = failure.message;
    nameError.value = failure.fields?.name ?? '';
    uncertain.value = failure.kind === 'network' || failure.kind === 'timeout' || failure.kind === 'contract';
    await nextTick(); document.querySelector<HTMLInputElement>('#board-name')?.focus();
  } finally { saving.value = false; }
  if (createdId) await router.push(`/boards/${createdId}`);
}
async function createTask(input: TaskDraft) {
  if (saving.value || uncertain.value || !board.value || membersError.value) return;
  saving.value = true; saveError.value = ''; fields.value = {}; pendingTask = input;
  try { const task = await api.createTask(board.value.id, input); ws.addTask(task); clearDialog(); }
  catch (e) {
    const failure = asRequestError(e); saveError.value = failure.message; fields.value = failure.fields ?? {};
    uncertain.value = failure.kind === 'network' || failure.kind === 'timeout' || failure.kind === 'contract';
  } finally { saving.value = false; }
}
async function verifyWrite() {
  await refresh(true);
  if (error.value || boardsError.value) { saveError.value = '查证失败，请恢复连接后再次刷新查证。'; return; }
  const matches = modal.value === 'board' ? boards.value.filter(b => b.name === name.value.trim()).length
    : tasks.value.filter(t => t.title === pendingTask?.title.trim()).length;
  saveError.value = `查证完成：已有 ${matches} 条同名记录。请核对列表；再次点击创建将新增一条记录。`;
  uncertain.value = false;
}
async function openDetail(taskId: string) {
  if (!board.value || saving.value) return;
  clearDialog(); modal.value = 'detail'; detailId.value = taskId; detailLoading.value = true; detailError.value = '';
  const generation = ++detailGeneration, boardId = board.value.id;
  try {
    const result = await api.getTask(boardId, taskId);
    if (generation === detailGeneration && board.value?.id === boardId) detail.value = result;
  } catch (e) {
    if (generation !== detailGeneration) return;
    const failure = asRequestError(e);
    detailError.value = failure.status === 404 ? '任务已不存在，请关闭详情并刷新看板。' : failure.message;
  } finally { if (generation === detailGeneration) detailLoading.value = false; }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="看板导航">
      <a class="brand" href="/" @click.prevent="!saving && router.push('/')"><span class="brand-mark">▦</span><span>团队看板<small>TEAM PLAN</small></span></a>
      <div class="workspace-label"><span class="workspace-avatar">协</span><div>项目协作空间<small>让每一步进展清晰可见</small></div></div>
      <div class="nav-heading"><span>我的看板 <b>{{ boards.length }}</b></span><button aria-label="新建看板" class="icon-button" :disabled="saving" @click="openBoard">＋</button></div>
      <p v-if="boardsError" class="sidebar-error" role="alert">看板列表读取失败 <button :disabled="saving || refreshing" @click="refresh()">重试</button></p>
      <nav><button v-for="item in boards" :key="item.id" class="board-link" :class="{ active: board?.id === item.id }" :aria-current="board?.id === item.id ? 'page' : undefined" :disabled="saving" @click="router.push(`/boards/${item.id}`)"><span class="board-initial">{{ Array.from(item.name)[0] }}</span><span>{{ item.name }}<small>{{ formatTimestamp(item.createdAt) }}</small></span></button></nav>
      <button class="add-board" :disabled="saving" @click="openBoard">＋ 新建看板</button>
      <div class="members-panel"><div class="nav-heading">团队成员 <span>{{ members.length }} 位</span></div><p v-if="membersError">负责人信息不可用</p><div v-for="(member, index) in members" :key="member.id" class="member-row"><span class="avatar" :class="`avatar-${index}`">{{ member.displayName.slice(-1) }}</span>{{ member.displayName }}</div><small>固定成员仅用于任务分配，不是登录账号。</small></div>
      <p class="sidebar-footer">团队任务协作<br>数据保存在本地服务</p>
    </aside>
    <div class="main-shell">
      <header class="topbar"><span>工作区 <span class="breadcrumb">／</span> <strong>{{ board?.name ?? '团队看板' }}</strong></span><span class="connection">● 本地服务</span></header>
      <main>
        <div v-if="route.name === 'not-found'" class="empty-state"><h1>页面不存在</h1><button @click="router.push('/')">返回看板列表</button></div>
        <template v-else>
          <div v-if="loading" class="loading-state" role="status"><h1>正在加载看板…</h1><div class="columns skeletons"><div v-for="i in 3" :key="i" class="column"><div v-for="j in 2" :key="j" class="skeleton" /></div></div></div>
          <div v-else-if="!board && !error" class="empty-state"><span class="empty-icon">▦</span><p class="eyebrow">从一个清晰的目标开始</p><h1>创建你的第一个看板</h1><p>把任务放进待办、进行中和已完成，<br>让团队看见每一步进展。</p><button class="primary" @click="openBoard">＋ 新建看板</button></div>
          <div v-if="error" class="notice error" role="alert"><span>{{ error }} {{ stale ? '当前数据可能已过期。' : '' }}</span><button :disabled="refreshing || saving" @click="refresh()">重试读取</button><button :disabled="saving" @click="router.push('/')">返回列表</button></div>
          <template v-if="board && !loading">
            <section class="board-header"><div><p class="eyebrow">团队看板</p><h1>{{ board.name }}</h1><p class="muted">创建于 {{ formatTimestamp(board.createdAt) }} <span>· {{ tasks.length }} 个任务</span></p></div><div class="board-actions"><div class="progress"><strong>{{ complete }} / {{ tasks.length }}</strong><small>已完成</small></div><button class="secondary" :disabled="refreshing || saving" @click="refresh()">{{ refreshing ? '刷新中…' : '刷新看板' }}</button><button class="primary" :disabled="saving || refreshing" @click="openTask()">＋ 新建任务</button></div></section>
            <div v-if="membersError" class="notice error" role="alert">负责人信息不可用，暂不能创建任务。<button :disabled="refreshing || saving" @click="refresh()">重试读取</button></div>
            <p class="scroll-hint">共 3 列 · 左右滑动查看待办、进行中和已完成</p>
            <div class="columns" aria-label="任务看板">
              <section v-for="column in columns" :key="column.status" class="column" :aria-label="STATUS_LABELS[column.status]" :data-status="column.status">
                <header class="column-header"><h2><span class="status-dot" :class="column.status" />{{ STATUS_LABELS[column.status] }} <span class="count">{{ column.tasks.length }}</span></h2><button class="icon-button" :aria-label="`在${STATUS_LABELS[column.status]}中新建任务`" :disabled="saving || refreshing" @click="openTask(column.status)">＋</button></header>
                <p class="column-subtitle">{{ column.status === 'todo' ? '尚未开始' : column.status === 'doing' ? '正在推进' : '已经完成' }}</p>
                <button v-for="task in column.tasks" :key="task.id" class="task-card" :data-task-id="task.id" :disabled="saving" @click="openDetail(task.id)"><span class="task-status" :class="task.status">{{ STATUS_LABELS[task.status] }}</span><h3>{{ task.title }}</h3><p v-if="task.description" class="task-excerpt">{{ task.description }}</p><footer><span class="task-person">{{ assignee(task) }}</span><span class="task-date">{{ task.dueDate ?? '未设置' }}</span></footer></button>
                <div v-if="!column.tasks.length" class="column-empty">暂无任务<span>给下一步行动留个位置</span></div>
                <button class="add-task" :disabled="saving || refreshing" @click="openTask(column.status)">＋ 添加任务</button>
              </section>
            </div>
            <p class="refresh-time" role="status">最后刷新：{{ formatTimestamp(lastRefresh) }}<span v-if="stale"> · 可能已过期</span> · 数据通过人工刷新更新</p>
          </template>
        </template>
      </main>
    </div>
    <ModalDialog v-if="modal === 'board'" title="新建看板" :busy="saving" @close="canLeave">
      <form novalidate @submit.prevent="createBoard"><label for="board-name">看板名称 <span class="required">*</span></label><input id="board-name" v-model="name" autofocus placeholder="例如：课程作业" :disabled="saving" :aria-invalid="!!nameError" aria-describedby="name-error" @input="onNameInput"><small id="name-error" class="field-error">{{ nameError }}</small><p class="muted">1～50 个字符，允许同名，创建后进入新看板。</p><p v-if="saveError" class="notice error" role="alert">{{ saveError }}</p><div v-if="uncertain" class="notice">结果尚不确定，请先查证。<button type="button" :disabled="refreshing" @click="verifyWrite">刷新查证</button></div><footer class="dialog-actions"><button type="button" class="secondary" :disabled="saving" @click="canLeave">取消</button><button class="primary" :disabled="saving || uncertain">{{ saving ? '正在保存…' : '创建看板' }}</button></footer></form>
    </ModalDialog>
    <ModalDialog v-if="modal === 'task'" title="新建任务" :busy="saving" @close="canLeave"><TaskForm :members="members" :members-error="membersError" :saving="saving" :fields="fields" :error="saveError" :initial-status="initialStatus" :uncertain="uncertain" @save="createTask" @dirty="dirty = $event" @cancel="canLeave" @retry-members="refresh(true)" @verify="verifyWrite" /></ModalDialog>
    <ModalDialog v-if="modal === 'detail'" title="任务详情" @close="canLeave"><p v-if="detailLoading" role="status">正在读取最新任务…</p><div v-else-if="detailError" class="notice error" role="alert">{{ detailError }}<button @click="openDetail(detailId)">重试详情</button></div><article v-else-if="detail" class="task-detail"><span class="task-status" :class="detail.status">{{ STATUS_LABELS[detail.status] }}</span><h2>{{ detail.title }}</h2><dl><div><dt>负责人</dt><dd>{{ assignee(detail) }}</dd></div><div><dt>截止日期</dt><dd>{{ detail.dueDate ?? '未设置' }}</dd></div><div><dt>创建时间</dt><dd>{{ formatTimestamp(detail.createdAt) }}</dd></div><div><dt>最后更新</dt><dd>{{ formatTimestamp(detail.updatedAt) }}</dd></div></dl><h3>任务描述</h3><p class="description">{{ detail.description || '暂无描述' }}</p></article><footer class="dialog-actions"><button class="secondary" @click="canLeave">关闭</button></footer></ModalDialog>
  </div>
</template>
