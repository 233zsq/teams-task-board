<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="error-page" role="alert">
    <div class="error-page__panel">
      <h1 class="error-page__title">页面不存在</h1>
      <p class="error-page__text">你访问的地址没有对应的页面。</p>
      <RouterLink class="btn btn--primary" to="/">返回看板</RouterLink>
    </div>
  </div>
</template>