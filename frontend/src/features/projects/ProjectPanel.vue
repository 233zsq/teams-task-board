<script setup lang="ts">
import { ref, watch } from 'vue';
import { formatBusinessDateTime, type Board, type ProjectActivity, type ProjectMember } from '@team-plan/shared';
import { account, accountApi } from '../../state/account';
import { useWorkspaceStore } from '../../state/injection';
import { ApiError } from '../../api/client';
import ModalDialog from '../ui/ModalDialog.vue';
import { describeError } from '../ui/messages';

const props = defineProps<{ board: Board }>();
const store = useWorkspaceStore();
const tab = ref<'members' | 'activity' | null>(null);
const members = ref<ProjectMember[]>([]);
const events = ref<ProjectActivity[]>([]);
const username = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const note = ref('');
let sequence = 0;
const labels: Record<string, string> = {
  'project.created': '创建了项目', 'task.created': '发布了任务', 'task.updated': '更新了任务',
  'task.deleted': '删除了任务', 'member.added': '添加了成员', 'member.removed': '移除了成员',
  'owner.transferred': '转交了项目负责人', 'project.claimed': '接管了历史项目',
};
async function load(): Promise<void> {
  const current = ++sequence;
  loading.value = true; error.value = '';
  const boardId = props.board.id;
  try {
    const [people, activity] = await Promise.all([
      accountApi.request<ProjectMember[]>('GET', `/boards/${boardId}/members`),
      accountApi.request<ProjectActivity[]>('GET', `/boards/${boardId}/activity`),
    ]);
    if (current !== sequence) return;
    members.value = people; events.value = activity;
  } catch (cause) { if (current === sequence) error.value = describeError(cause); }
  finally { if (current === sequence) loading.value = false; }
}
function open(value: 'members' | 'activity'): void { tab.value = value; note.value = ''; void load(); }
async function mutate(method: string, path: string, body?: unknown): Promise<void> {
  if (busy.value) return;
  busy.value = true; error.value = ''; note.value = '';
  try {
    await accountApi.request(method, `/boards/${props.board.id}${path}`, { body });
    username.value = '';
    await store.refreshBoard();
    await load();
    note.value = '项目成员已更新';
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.fields ? Object.values(cause.fields).join('；') : describeError(cause);
  } finally { busy.value = false; }
}
function remove(member: ProjectMember): void {
  if (window.confirm(`移除“${member.displayName}”？该成员将无法访问项目，分配给他的任务会变为未分配。`)) {
    void mutate('DELETE', `/members/${member.id}`);
  }
}
function transfer(member: ProjectMember): void {
  if (window.confirm(`将项目负责人转交给“${member.displayName}”？转交后你将成为普通成员。`)) {
    void mutate('PUT', '/owner', { userId: member.id });
  }
}
watch(() => props.board.id, () => { sequence++; tab.value = null; members.value = []; events.value = []; });
</script>

<template>
  <div v-if="account.user" class="project-tools">
    <span class="project-owner"><span class="mini-avatar">{{ board.owner?.displayName.slice(0, 1) ?? '?' }}</span>项目负责人 <strong>{{ board.owner?.displayName ?? '待接管' }}</strong></span>
    <div><button class="btn btn--outline btn--sm" @click="open('members')">项目成员 · {{ board.memberCount ?? 0 }}</button><button class="btn btn--outline btn--sm" @click="open('activity')">最近动态</button></div>
  </div>
  <ModalDialog v-if="tab" :title="tab === 'members' ? '项目成员' : '最近动态'" @close="!busy && (tab = null)">
    <div class="project-panel">
      <p v-if="loading" role="status">正在读取…</p>
      <p v-if="error" class="notice notice--danger" role="alert">{{ error }} <button class="btn btn--outline btn--sm" @click="load">重试</button></p>
      <p v-if="note" class="notice notice--success" role="status">{{ note }}</p>
      <template v-if="tab === 'members'">
        <p class="text-muted">项目成员可协作维护任务；项目负责人可管理成员和转交负责人。</p>
        <ul class="project-member-list"><li v-for="member in members" :key="member.id"><span class="mini-avatar">{{ member.displayName.slice(0, 1) }}</span><div class="project-member-name"><strong>{{ member.displayName }}</strong><small>@{{ member.username }}</small></div><span class="chip">{{ member.role === 'owner' ? '项目负责人' : '成员' }}</span><div v-if="board.role === 'owner' && member.role !== 'owner'" class="member-actions"><button class="btn btn--outline btn--sm" :disabled="busy" @click="transfer(member)">转交负责人</button><button class="btn btn--danger-ghost btn--sm" :disabled="busy" @click="remove(member)">移除</button></div></li></ul>
        <form v-if="board.role === 'owner'" class="account-form project-invite" @submit.prevent="mutate('POST', '/members', { username })"><h3>添加伙伴</h3><p class="text-muted">请对方先注册，再填写其用户名即可加入项目。</p><label>成员用户名<input v-model="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" :disabled="busy" placeholder="例如 teammate_01"></label><button class="btn btn--primary" :disabled="busy || loading">{{ busy ? '正在添加…' : '添加到项目' }}</button></form>
      </template>
      <template v-else>
        <p class="text-muted">最近 50 条项目操作，刷新后读取最新记录。</p>
        <p v-if="!loading && !error && !events.length" class="project-empty">还没有项目动态</p>
        <ol class="activity-list"><li v-for="event in events" :key="event.id"><span class="mini-avatar">{{ event.actor.displayName.slice(0, 1) }}</span><div><p><strong>{{ event.actor.displayName }}</strong> {{ labels[event.action] ?? '更新了项目' }}</p><p class="activity-subject">{{ event.subject }}</p><time>{{ formatBusinessDateTime(event.createdAt) }}</time></div></li></ol>
      </template>
    </div>
  </ModalDialog>
</template>
