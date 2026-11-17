<script setup lang="ts">
import type { ForumTag } from '../useMessages'
defineProps<{ tags: ForumTag[]; selected: string; loading: boolean; error: string }>()
defineEmits<{ select: [tag: string]; retry: [] }>()
</script>
<template>
  <section class="tag-directory" aria-label="按论坛标签筛选">
    <div class="tag-directory-heading"><h2>论坛标签</h2><span aria-hidden="true">#</span></div>
    <p v-if="error" class="tag-error" role="alert">{{ error }} <button class="text-link" @click="$emit('retry')">重试</button></p>
    <p v-else-if="loading" class="tag-loading" role="status">正在加载标签…</p>
    <div class="tag-options"><button :aria-pressed="!selected" :class="{ selected: !selected }" @click="$emit('select', '')">全部</button><button v-for="tag in tags" :key="tag.id" :data-tag="tag.id" :aria-pressed="selected === tag.id" :class="{ selected: selected === tag.id }" @click="$emit('select', tag.id)"><span aria-hidden="true">#</span>{{ tag.label }}</button></div>
    <p class="tag-directory-hint">选择标签，看看同好们在聊什么。</p>
  </section>
</template>
