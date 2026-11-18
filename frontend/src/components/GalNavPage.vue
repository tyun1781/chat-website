<script setup lang="ts">
import { ref } from 'vue'
import { galLinks, type GalLink } from '../galLinks'
const emit = defineEmits<{ back: [] }>()
const failed = ref(new Set<string>())
function fail(item: GalLink) {
  const next = new Set(failed.value)
  next.add(item.id)
  failed.value = next
}
</script>

<template>
  <section class="gal-nav-page" aria-labelledby="gal-nav-title">
    <div v-reveal class="page-heading"><p lang="ja">ぎゃるげーむ、はじめよう (｡･ω･｡)ﾉ</p><h1 id="gal-nav-title">来点galgame？</h1><span>一些视觉小说与 Galgame 相关站点，慢慢挑一个进去看看。</span></div>
    <div v-reveal="{ delay: 40 }" class="gal-toolbar"><span>{{ galLinks.length }} 个站点 · 个人收藏向</span><button class="text-link" @click="emit('back')">返回工具</button></div>
    <p v-reveal="{ delay: 60 }" class="gal-note">以下多为第三方社区或资源站，内容与版权请自行判断；链接会在新标签页打开。</p>
    <div class="gal-grid">
      <a v-for="(item, index) in galLinks" :key="item.id" v-reveal="{ delay: Math.min(index * 45, 180) }" class="gal-link-card" :href="item.url" target="_blank" rel="noopener noreferrer">
        <span class="gal-icon-wrap">
          <img v-if="!failed.has(item.id)" class="gal-icon" :src="item.icon" :alt="`${item.name} 图标`" width="58" height="58" @error="fail(item)">
          <span v-else class="gal-icon-fallback" aria-hidden="true">{{ Array.from(item.name)[0] }}</span>
        </span>
        <span class="gal-link-body">
          <span class="gal-link-title">{{ item.name }} <span class="gal-link-arrow" aria-hidden="true">↗</span></span>
          <span class="gal-link-desc">{{ item.description }}</span>
          <span class="gal-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span>
        </span>
      </a>
    </div>
  </section>
</template>
