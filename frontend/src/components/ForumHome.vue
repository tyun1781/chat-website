<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { user } from '../api'
import { useMessages } from '../useMessages'
import { displayTime, type Person } from '../forumTypes'
import CommentsPanel from './CommentsPanel.vue'
import TagFilter from './TagFilter.vue'
defineProps<{ restoring: boolean }>()
const emit = defineEmits<{ login: []; chat: [person: Person]; inbox: []; profile: [] }>()
const { forumEvents, messages, draft, draftLength, loading, loadingMore, loadError, publishError, deleteError, actionNotice, publishing, deleting, hasMore, status, statusText, reload, loadMore, publish, deleteMessage, tags, tagsLoading, tagsError, selectedTag, composeTag, selectTag, loadTags, tagLabel } = useMessages()
const confirmDelete = ref<string | null>(null), expanded = ref(new Set<string>())
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
function filterTag(tag: string) { expanded.value.clear(); confirmDelete.value = null; void selectTag(tag) }
function submitPost() { if (!user.value) emit('login'); else void publish() }
async function removePost(id: string) { await deleteMessage(id); confirmDelete.value = null }
function focusComposer(topic?: string) { if (topic && !draft.value.trim()) draft.value = topic; nextTick(() => { const input = document.querySelector<HTMLTextAreaElement>('#draft'); input?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); input?.focus({ preventScroll: true }) }) }
</script>
<template>
  <div class="forum-home">
  <section class="forum-hero" aria-labelledby="main-title">
    <div class="hero-copy"><p class="club-label" lang="ja"><span aria-hidden="true">✦</span> こんにちは、今日もよろしく</p><h1 id="main-title" tabindex="-1"><span class="hero-kaomoji">(｡･ω･｡)ﾉ</span>喜欢的事，<br>为你分享</h1><p class="hero-description">新番、游戏、循环播放的歌，<br>还有那些闪闪发光的日常。</p><button class="hero-cta" @click="focusComposer()">开启一个话题 <span aria-hidden="true">＋</span></button></div>
    <div class="hero-art sora-art"><span class="hello-bubble">Ciallo (∠・ω&lt;)⌒☆</span><div class="sora-portrait"><img src="/images/sora-chibi-reference.jpg" alt="穹妹的Q版人物插画" width="864" height="1920"></div><span class="art-caption" lang="ja">のんびり、いこう。</span></div>
  </section>
  <div class="forum-grid">
    <section class="forum-feed" aria-labelledby="board-title">
      <div class="section-heading"><div><h2 id="board-title">讨论广场</h2><span class="section-subtitle">每个喜欢，都值得展开聊聊</span></div><span class="status-label" :class="{ 'is-live': status === 'live' }" role="status">{{ statusText }}</span></div>
      <form class="post-composer" @submit.prevent="submitPost">
        <div class="composer-top"><span class="avatar" aria-hidden="true">{{ user ? Array.from(user.nickname)[0] : '✦' }}</span><label for="draft">{{ user ? `${user.nickname}，说点什么？` : '说点什么？' }}</label><span class="public-label">公开发帖</span></div>
        <textarea id="draft" v-model="draft" :disabled="publishing" maxlength="1000" placeholder="说点什么？" rows="3" aria-describedby="draft-help draft-count" :aria-invalid="draftLength > 500"></textarea>
        <p v-if="publishError" class="message-error" role="alert">{{ publishError }}</p><p v-if="actionNotice" class="action-notice" role="status">{{ actionNotice }}</p>
        <div class="composer-tag"><label for="post-tag">帖子标签</label><select id="post-tag" v-model="composeTag" :disabled="publishing || tagsLoading || !tags.length"><option v-if="!tags.length" value="">{{ tagsLoading ? '正在加载…' : '标签暂不可用' }}</option><option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.label }}</option></select><button v-if="tagsError" type="button" class="text-link" @click="loadTags">重新加载标签</button></div>
        <div class="composer-bottom"><span id="draft-count" :class="{ 'over-limit': draftLength > 500 }">{{ draftLength }} / 500 字</span><button class="small-button" :disabled="publishing || restoring || (!!user && (!draftLength || draftLength > 500 || !tags.length))">{{ publishing ? '正在发布…' : user ? '发布帖子' : '登录后发布' }}</button></div><p id="draft-help" class="draft-help">帖子与评论对所有人可见；未发布内容刷新后清空。</p>
      </form>
      <TagFilter class="mobile-tag-directory" :tags="tags" :selected="selectedTag" :loading="tagsLoading" :error="tagsError" @select="filterTag" @retry="loadTags" />
      <div class="feed-divider"><h3>{{ selectedTag ? `${tagLabel(selectedTag)} · 最新帖子` : '最新帖子' }}</h3><span>按发布时间排序</span></div>
      <div v-if="loadError" class="message-error" role="alert">{{ loadError }} <button class="text-link" :disabled="loading || loadingMore" @click="messages.length ? loadMore() : reload()">重新加载</button></div><p v-if="deleteError" class="message-error" role="alert">{{ deleteError }}</p>
      <p v-if="loading" class="quiet-state" role="status">正在连接讨论广场…</p>
      <div v-else-if="!messages.length && !loadError" class="empty-state"><span class="empty-spark" aria-hidden="true">✧</span><h3>{{ selectedTag ? `“${tagLabel(selectedTag)}”还没有帖子。` : '故事，从你的第一帖开始。' }}</h3><p>最近有什么让你心动的作品？<br>把这个话题带给大家吧。</p><button class="text-link" @click="focusComposer()">写下第一帖</button></div>
      <ol v-else class="message-list" aria-label="公开帖子，最新在前">
        <li v-for="message in messages" :key="message.id" class="message-item"><article :aria-label="`${message.author.nickname} 的帖子`">
          <div class="message-heading"><button class="avatar author-avatar" :aria-label="`与 ${message.author.nickname} 私聊`" :disabled="user?.id === message.author.id" @click="emit('chat', message.author)">{{ Array.from(message.author.nickname)[0] }}</button><div class="message-byline"><h3><button class="author-link" :disabled="user?.id === message.author.id" @click="emit('chat', message.author)">{{ message.author.nickname }}</button></h3><time :datetime="message.createdAt">{{ displayTime(message.createdAt) }}</time></div><span v-if="user?.id === message.author.id" class="self-label">我的帖子</span><span v-else class="post-badge">公开讨论</span></div>
          <button class="post-tag" :aria-label="`查看${tagLabel(message.tag || 'daily')}标签的帖子`" @click="filterTag(message.tag || 'daily')"># {{ tagLabel(message.tag || 'daily') }}</button>
          <p class="message-body">{{ message.body }}</p>
          <div class="post-actions"><button :aria-expanded="expanded.has(message.id)" :aria-controls="`comments-${message.id}`" :class="{ active: expanded.has(message.id) }" @click="toggle(message.id)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 3V5a2 2 0 0 1 1-2Z" /></svg>{{ expanded.has(message.id) ? '收起评论' : '展开评论' }}</button><button v-if="user?.id !== message.author.id" @click="emit('chat', message.author)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h16v11H2V5Zm0 0 8 6 8-6" /></svg>私聊作者</button><div v-if="user?.id === message.author.id" class="message-actions"><template v-if="confirmDelete === message.id"><span>删除帖子？</span><button class="delete-confirm" :disabled="!!deleting" @click="removePost(message.id)">{{ deleting ? '删除中…' : '确认删除' }}</button><button :disabled="!!deleting" @click="confirmDelete = null">取消</button></template><button v-else :disabled="!!deleting" @click="confirmDelete = message.id">删除</button></div></div>
          <CommentsPanel v-if="expanded.has(message.id)" :id="`comments-${message.id}`" :post-id="message.id" :events="forumEvents" @login="emit('login')" @chat="emit('chat', $event)" />
        </article></li>
      </ol>
      <button v-if="hasMore" class="load-more" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '正在加载…' : '查看更多帖子' }}</button><p v-else-if="messages.length && !loading" class="list-end">已经看到最早的帖子啦 ✧</p>
    </section>
    <aside class="forum-sidebar" aria-label="社团信息">
      <section class="member-note"><span class="member-star" aria-hidden="true">✦</span><p class="side-kicker" lang="ja">いらっしゃい (｡･ω･｡)</p><h2>{{ user ? user.nickname : '下一位同好，会是你吗？' }}</h2><p>{{ user ? '今天也要分享一点喜欢。' : '注册一个账号，把喜欢分享给懂你的人。' }}</p><button class="sidebar-button" @click="user ? emit('profile') : emit('login')">{{ user ? '我的个人资料' : '加入讨论' }}</button></section>
      <TagFilter :tags="tags" :selected="selectedTag" :loading="tagsLoading" :error="tagsError" @select="filterTag" @retry="loadTags" />
      <button class="mail-invite" @click="emit('inbox')"><span aria-hidden="true">✉</span><span><strong>想单独聊聊？</strong><small>去悄悄话信箱认识同好</small></span></button>
      <section class="community-note"><h2>同好之间，温柔一点。</h2><p>尊重彼此的喜欢，不剧透、不引战。<br>请勿公开个人隐私或他人的信息。</p></section>
    </aside>
  </div>
  </div>
</template>
