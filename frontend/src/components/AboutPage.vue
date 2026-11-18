<script setup lang="ts">
const emit = defineEmits<{ forum: [] }>()
const bilibiliUrl = 'https://space.bilibili.com/509574643'
</script>

<template>
  <section class="about-page" aria-labelledby="about-title">
    <div v-reveal class="page-heading"><p lang="ja">はじめまして (｡･ω･｡)ﾉ</p><h1 id="about-title">关于作者</h1><span>来自 INCH 的一英寸自我介绍</span></div>
    <article v-reveal="{ delay: 80 }" class="about-card">
      <div class="about-avatar" aria-hidden="true">✦</div>
      <p class="about-greeting">Ciallo～(∠・ω&lt; )⌒☆</p>
      <h2>inch.zy</h2>
      <p class="about-tags"><span>动画</span><span>Galgame</span><span>游戏</span><span>音乐</span></p>
      <p class="about-body">喜欢把喜欢的作品认真讲给同好听。INCH 是我留的一英寸小角落，欢迎来聊。</p>
      <div class="about-actions">
        <a class="primary-button" :href="bilibiliUrl" target="_blank" rel="noopener noreferrer">前往 B 站空间 <span aria-hidden="true">↗</span></a>
        <button class="text-link" type="button" @click="emit('forum')">返回讨论广场</button>
      </div>
      <p class="about-note">Bilibili：<a :href="bilibiliUrl" target="_blank" rel="noopener noreferrer">space.bilibili.com/509574643</a></p>
    </article>
  </section>
</template>
