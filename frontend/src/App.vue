<script setup lang="ts">
import { inject, onMounted, onUnmounted, onErrorCaptured, ref } from 'vue';
import { API_KEY, asRequestError } from './api/service';
const api = inject(API_KEY)!;
const loading = ref(true);
const error = ref('');
const fatal = ref(false);
const featureWarning = ref(false);
const demo = import.meta.env.MODE === 'demo';
async function checkHealth() {
  loading.value = true; error.value = '';
  try {
    const health = await api.health();
    if (health.status !== 'ok') throw new Error('health');
    featureWarning.value = Object.values(health.features).some(Boolean);
  } catch (e) { error.value = asRequestError(e).message; }
  finally { loading.value = false; }
}
function crash() { fatal.value = true; }
function reload() { window.location.reload(); }
onErrorCaptured(() => { crash(); return false; });
onMounted(() => { void checkHealth(); window.addEventListener('unhandledrejection', crash); });
onUnmounted(() => window.removeEventListener('unhandledrejection', crash));
</script>

<template>
  <div v-if="fatal" class="boot" role="alert"><h1>页面遇到问题</h1><p>请刷新页面重新加载服务端数据。</p><button @click="reload">刷新页面</button></div>
  <div v-else-if="loading" class="boot" role="status"><span class="brand-mark">▦</span><h1>正在连接团队看板</h1><p>检查服务与数据库…</p></div>
  <div v-else-if="error" class="boot" role="alert"><h1>暂时无法进入工作区</h1><p>{{ error }}</p><button @click="checkHealth">重试连接</button></div>
  <template v-else>
    <div v-if="demo" class="demo-banner">开发夹具模式 · 数据仅在内存中，刷新即重置，不代表真实持久化</div>
    <div v-if="featureWarning" class="notice" role="status">服务端启用了本界面尚不支持的扩展，请核对版本；本页仅提供 S1 功能。</div>
    <RouterView />
  </template>
</template>
