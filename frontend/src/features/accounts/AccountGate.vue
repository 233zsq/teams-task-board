<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AccountSession, AccountUser } from '@team-plan/shared';
import App from '../../App.vue';
import { acceptSession, account, accountApi, forgetSession, restoreSession } from '../../state/account';
import { ApiError } from '../../api/client';
import { confirmLeave } from '../ui/leaveGuard';
import { describeError } from '../ui/messages';
import ModalDialog from '../ui/ModalDialog.vue';

const router = useRouter();
const mode = ref<'login' | 'register'>('login');
const username = ref('');
const displayName = ref('');
const password = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const error = ref('');
const fields = ref<Record<string, string>>({});
const expired = ref(false);
const settings = ref(false);
const nickname = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const newConfirmation = ref('');
const notice = ref('');
const settingsError = ref('');

function failure(cause: unknown): string {
  if (cause instanceof ApiError && cause.fields) return Object.values(cause.fields).join('；');
  return describeError(cause);
}
async function load(): Promise<void> {
  error.value = '';
  try { await restoreSession(); }
  catch (cause) { error.value = failure(cause); }
}
function switchMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login';
  password.value = ''; confirmPassword.value = ''; fields.value = {}; error.value = '';
}
async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = ''; fields.value = {};
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'; return;
  }
  busy.value = true;
  try {
    const session = await accountApi.request<AccountSession>('POST', `/auth/${mode.value}`, { body: {
      username: username.value, password: password.value,
      ...(mode.value === 'register' ? { displayName: displayName.value } : {}),
    } });
    acceptSession(session);
    channel?.postMessage('changed');
    password.value = ''; confirmPassword.value = ''; expired.value = false;
    // Preserve a direct project URL; the server still enforces membership.
  } catch (cause) {
    error.value = failure(cause);
    if (cause instanceof ApiError) fields.value = cause.fields ?? {};
  } finally { busy.value = false; }
}
async function logout(): Promise<void> {
  if (busy.value || !(await confirmLeave())) return;
  busy.value = true;
  try {
    await accountApi.request<void>('POST', '/auth/logout');
    mode.value = 'login'; password.value = ''; confirmPassword.value = ''; error.value = '';
    forgetSession(); settings.value = false; await router.replace('/');
    channel?.postMessage('changed');
  } catch (cause) { settingsError.value = failure(cause); settings.value = true; }
  finally { busy.value = false; }
}
function openSettings(): void {
  nickname.value = account.user?.displayName ?? '';
  currentPassword.value = ''; newPassword.value = ''; newConfirmation.value = '';
  notice.value = ''; settingsError.value = ''; settings.value = true;
}
async function profile(): Promise<void> {
  if (busy.value) return;
  busy.value = true; settingsError.value = ''; notice.value = '';
  try {
    account.user = await accountApi.request<AccountUser>('PUT', '/auth/profile', { body: { displayName: nickname.value } });
    notice.value = '昵称已更新';
    // Refresh identity labels throughout the current workspace without losing navigation.
    window.dispatchEvent(new Event('account:profile'));
  } catch (cause) { settingsError.value = failure(cause); }
  finally { busy.value = false; }
}
async function changePassword(): Promise<void> {
  if (busy.value) return;
  settingsError.value = ''; notice.value = '';
  if (newPassword.value !== newConfirmation.value) { settingsError.value = '两次新密码不一致'; return; }
  busy.value = true;
  try {
    const session = await accountApi.request<AccountSession>('PUT', '/auth/password', { body: { currentPassword: currentPassword.value, newPassword: newPassword.value } });
    acceptSession(session);
    currentPassword.value = ''; newPassword.value = ''; newConfirmation.value = '';
    notice.value = '密码已更新，其他登录会话已退出'; channel?.postMessage('changed');
    window.dispatchEvent(new Event('account:profile'));
  } catch (cause) { settingsError.value = failure(cause); }
  finally { busy.value = false; }
}
function onExpired(): void {
  if (!account.user) return;
  forgetSession(); settings.value = false; expired.value = true;
  mode.value = 'login'; password.value = ''; confirmPassword.value = '';
}
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('team-plan-account');
if (channel) channel.onmessage = () => { void load(); };
onMounted(() => { void load(); window.addEventListener('account:expired', onExpired); });
onBeforeUnmount(() => { window.removeEventListener('account:expired', onExpired); channel?.close(); });
</script>

<template>
  <div v-if="!account.ready" class="auth-loading" role="status">
    <p>{{ error || '正在恢复登录状态…' }}</p>
    <button v-if="error" class="btn btn--primary" @click="load">重新连接</button>
  </div>
  <div v-else-if="!account.user" class="auth-page">
    <section class="auth-story" aria-labelledby="auth-title">
      <div class="auth-brand"><span class="brand__mark">T</span> TEAM PLAN</div>
      <p class="auth-eyebrow">让每一次协作，都有迹可循</p>
      <h1 id="auth-title">从一个想法，<br>到一起完成。</h1>
      <p class="auth-story__copy">建立项目、邀请伙伴、分配任务。谁发布、谁负责、做到哪，一眼就清楚。</p>
      <div class="auth-preview" aria-hidden="true">
        <div><span class="auth-dot"></span> 我们的下一个项目 <span class="auth-preview__count">3 位伙伴</span></div>
        <div class="auth-preview__task"><span>✓</span><p>把想法写成计划<small>已完成 · 项目负责人</small></p></div>
        <div class="auth-preview__task"><span>↗</span><p>让任务找到合适的人<small>进行中 · 团队协作</small></p></div>
        <div class="auth-preview__progress"><i></i></div>
      </div>
      <p class="auth-footnote">清晰分工 · 共同推进 · 记录每一步</p>
    </section>
    <section class="auth-form-panel">
      <div class="auth-form-wrap">
        <p class="auth-eyebrow">你的团队工作空间</p>
        <h2>{{ mode === 'login' ? '欢迎回来' : '创建你的账号' }}</h2>
        <p class="auth-intro">{{ mode === 'login' ? '登录后，继续推进你和伙伴的项目。' : '先认识你，再开始第一场协作。' }}</p>
        <p v-if="expired" class="notice notice--warning" role="status">登录已过期，请重新登录。未保存的内容请重新核对。</p>
        <form class="account-form" @submit.prevent="submit">
          <label>用户名<input v-model="username" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" :disabled="busy" placeholder="字母、数字或下划线" :aria-invalid="!!fields.username"></label>
          <label v-if="mode === 'register'">昵称<input v-model="displayName" name="displayName" autocomplete="nickname" required maxlength="30" :disabled="busy" placeholder="伙伴们如何称呼你" :aria-invalid="!!fields.displayName"></label>
          <label>密码<input v-model="password" name="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required :minlength="mode === 'register' ? 12 : 1" maxlength="128" :disabled="busy" :placeholder="mode === 'login' ? '输入你的密码' : '至少 12 个字符，可使用长口令'" :aria-invalid="!!fields.password"></label>
          <label v-if="mode === 'register'">确认密码<input v-model="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" :disabled="busy" placeholder="再次输入密码"></label>
          <p v-if="error" class="notice notice--danger" role="alert">{{ error }}</p>
          <button class="btn btn--primary auth-submit" type="submit" :disabled="busy">{{ busy ? '正在处理…' : mode === 'login' ? '登录工作空间 →' : '注册并开始协作 →' }}</button>
        </form>
        <p class="auth-switch">{{ mode === 'login' ? '第一次来到这里？' : '已经有账号？' }}<button type="button" :disabled="busy" @click="switchMode">{{ mode === 'login' ? '注册账号' : '返回登录' }}</button></p>
        <p class="auth-hint">用户名用于登录和加入项目，昵称用于团队展示。注册后可创建项目，或请负责人按用户名添加你。</p>
      </div>
    </section>
  </div>
  <div v-else class="account-root">
    <div class="account-bar"><span>TEAM PLAN <span class="account-bar__tag">团队协作</span></span><div><button class="account-avatar" @click="openSettings" aria-label="账号设置">{{ account.user.displayName.slice(0, 1) }}</button><button class="account-name" @click="openSettings">{{ account.user.displayName }}</button><button class="account-logout" :disabled="busy" @click="logout">退出登录</button></div></div>
    <App :key="account.user.id" />
    <ModalDialog v-if="settings" title="账号设置" @close="!busy && (settings = false)">
      <div class="account-settings">
        <p class="text-muted">用户名：@{{ account.user.username }}</p>
        <form class="account-form" @submit.prevent="profile"><label>昵称<input v-model="nickname" required maxlength="30" :disabled="busy" autocomplete="nickname"></label><button class="btn btn--outline" :disabled="busy">保存昵称</button></form>
        <hr>
        <h3>修改密码</h3>
        <form class="account-form" @submit.prevent="changePassword"><label>当前密码<input v-model="currentPassword" type="password" required maxlength="128" :disabled="busy" autocomplete="current-password"></label><label>新密码<input v-model="newPassword" type="password" required minlength="12" maxlength="128" :disabled="busy" autocomplete="new-password"></label><label>确认新密码<input v-model="newConfirmation" type="password" required minlength="12" maxlength="128" :disabled="busy" autocomplete="new-password"></label><button class="btn btn--primary" :disabled="busy">更新密码</button></form>
        <p v-if="settingsError" class="notice notice--danger" role="alert">{{ settingsError }}</p><p v-if="notice" class="notice notice--success" role="status">{{ notice }}</p>
      </div>
    </ModalDialog>
  </div>
</template>
