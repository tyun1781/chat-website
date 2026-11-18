<script setup lang="ts">
import { ref, watch } from 'vue'
import { user } from '../api'
import { displayTime, failureMessage } from '../forumTypes'
import {
  getNotifications, markAllNotificationsRead, markNotificationRead, unreadNotifications,
  type AppNotification
} from '../notificationsApi'
const emit = defineEmits<{ login: []; forum: [] }>()
const notifications = ref<AppNotification[]>([])
const loading = ref(false), loadingMore = ref(false), error = ref(''), notice = ref(''), hasMore = ref(false)
let cursor: string | null = null
const typeLabel = (type: string) => type === 'message.deleted' ? '帖子管理' : type
async function load(reset = true) {
  if (!user.value) { notifications.value = []; hasMore.value = false; cursor = null; return }
  if (reset) { loading.value = true; notifications.value = []; cursor = null } else { loadingMore.value = true }
  error.value = ''
  try {
    const page = await getNotifications(20, cursor || undefined)
    notifications.value = reset ? page.data : [...notifications.value, ...page.data]
    cursor = page.page.nextCursor; hasMore.value = page.page.hasMore; unreadNotifications.value = page.unreadCount
  } catch (e) { error.value = failureMessage(e) }
  finally { loading.value = false; loadingMore.value = false }
}
async function read(item: AppNotification) {
  if (item.readAt) return
  error.value = ''; notice.value = ''
  try {
    await markNotificationRead(item.id); item.readAt = new Date().toISOString(); notice.value = '已标记为已读。'
  } catch (e) { error.value = failureMessage(e) }
}
async function readAll() {
  if (!unreadNotifications.value) return
  error.value = ''; notice.value = ''
  try {
    const updated = await markAllNotificationsRead()
    notifications.value = notifications.value.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() }))
    notice.value = updated ? `已将 ${updated} 条通知标记为已读。` : '当前没有未读通知。'
  } catch (e) { error.value = failureMessage(e) }
}
watch(() => user.value?.id, () => { void load(true) }, { immediate: true })
</script>

<template>
  <section class="notifications-page" aria-labelledby="notifications-title">
    <div v-reveal class="page-heading"><p lang="ja">おしらせ (｡･ω･｡)ﾉ</p><h1 id="notifications-title">通知</h1><span>管理员删除帖子时，会在这里说明原因</span></div>
    <div v-if="!user" v-reveal class="notification-guard"><span class="tool-mark" aria-hidden="true">✉</span><h2>登录后查看通知</h2><p>帖子被管理员删除时，原因会发送到你的账号通知里。</p><div class="admin-guard-actions"><button class="small-button" @click="emit('login')">登录</button><button class="text-link" @click="emit('forum')">返回讨论广场</button></div></div>
    <template v-else>
      <div v-reveal class="notification-toolbar"><span>{{ unreadNotifications }} 条未读</span><div><button class="text-link" :disabled="loading || loadingMore" @click="load(true)">刷新</button><button v-if="unreadNotifications" class="small-button" @click="readAll">全部已读</button></div></div>
      <p v-if="error" class="message-error" role="alert">{{ error }} <button class="text-link" @click="load(true)">重新加载</button></p>
      <p v-if="notice" class="action-notice" role="status">{{ notice }}</p>
      <p v-if="loading" class="quiet-state" role="status">正在加载通知…</p>
      <p v-else-if="!notifications.length" class="quiet-state">还没有通知。希望这里一直安安静静。</p>
      <ol v-else class="notification-list">
        <li v-for="(item, index) in notifications" :key="item.id" v-reveal="{ delay: Math.min(index * 45, 180) }" class="notification-item" :class="{ unread: !item.readAt }">
          <div class="notification-head"><span class="notification-type">{{ typeLabel(item.type) }}</span><time :datetime="item.createdAt">{{ displayTime(item.createdAt) }}</time></div>
          <h2>{{ item.title }}</h2>
          <p class="notification-reason">删除原因：{{ item.body }}</p>
          <p v-if="item.data.excerpt" class="notification-excerpt">被删除的帖子内容：“{{ item.data.excerpt }}”</p>
          <div class="notification-actions"><span v-if="item.readAt" class="admin-muted">已读</span><button v-else class="text-link" @click="read(item)">标为已读</button></div>
        </li>
      </ol>
      <button v-if="hasMore" class="load-more" :disabled="loadingMore" @click="load(false)">{{ loadingMore ? '正在加载…' : '加载更早的通知' }}</button>
    </template>
  </section>
</template>
