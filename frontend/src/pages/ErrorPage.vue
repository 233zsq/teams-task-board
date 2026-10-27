<script setup lang="ts">
defineProps<{ detail?: string }>();
defineEmits<{ reload: [] }>();
</script>

<template>
  <div class="error-page" role="alert">
    <div class="error-page__panel">
      <h1 class="error-page__title">页面遇到问题</h1>
      <p class="error-page__text">
        界面发生未预期的异常，当前操作可能没有完成。请刷新页面继续；已保存的数据仍在服务器上。
      </p>
      <p v-if="detail" class="error-page__detail">{{ detail }}</p>
      <button type="button" class="btn btn--primary" @click="$emit('reload')">刷新页面</button>
    </div>
  </div>
</template>