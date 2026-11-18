<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { user } from '../api'
import { getAdminApplications, getAdminAuditLogs, type AdminApplication, type AuditLog } from '../adminApi'
import { displayTime, failureMessage } from '../forumTypes'
const emit = defineEmits<{ admin: []; forum: []; login: [] }>()
const logs = ref<AuditLog[]>([]), pending = ref<AdminApplication[]>([])
const summary = ref({ pendingApplications: 0, recentActions: 0 })
const loading = ref(false), loadingMore = ref(false), pendingLoading = ref(false), error = ref('')
let cursor: string | null = null
const isAdmin = computed(() => user.value?.role === 'admin')
const actionLabel = (action: string) => ({
  'admin_application.approved': '通过管理员申请',
  'admin_application.rejected': '拒绝管理员申请',
  'user.disabled': '禁用账号',
  'user.enabled': '恢复账号',
  'message.deleted': '管理员删除帖子'
}[action] || action)
const actionTone = (action: string) => action.includes('rejected') || action.includes('disabled') || action.includes('deleted') ? 'is-danger' : action.includes('approved') || action.includes('enabled') ? 'is-positive' : ''
async function load(reset = true) {
  if (!isAdmin.value) return
  if (reset) { loading.value = true; logs.value = []; cursor = null } else loadingMore.value = true
  error.value = ''
  try {
    const page = await getAdminAuditLogs(30, cursor || undefined)
    logs.value = reset ? page.data : [...logs.value, ...page.data]
    cursor = page.page.nextCursor
    summary.value = page.summary
  } catch (e) { error.value = failureMessage(e) }
  finally { loading.value = false; loadingMore.value = false }
}
async function loadPending() {
  if (!isAdmin.value) return
  pendingLoading.value = true
  try { pending.value = (await getAdminApplications('pending')).data.slice(0, 6) }
  catch (e) { if (!error.value) error.value = failureMessage(e) }
  finally { pendingLoading.value = false }
}
function refresh() { error.value = ''; void load(true); void loadPending() }
watch(() => user.value?.role, role => { if (role === 'admin') refresh() }, { immediate: true })
</script>

<template>
  <section class="logs-page" aria-labelledby="logs-title">
    <div v-reveal class="page-heading"><p lang="ja">activity log (｡･ω･｡)ﾉ</p><h1 id="logs-title">日志通知</h1><span>管理员申请、账号操作和帖子管理的最近记录</span></div>
    <div v-if="!isAdmin" v-reveal class="admin-guard"><span class="tool-mark" aria-hidden="true">✦</span><h2>{{ user ? '需要管理员权限' : '请先登录管理员账号' }}</h2><p>{{ user ? '当前账号不是管理员，无法查看管理日志。' : '登录管理员账号后，这里会显示待处理事项和操作记录。' }}</p><div class="admin-guard-actions"><button v-if="!user" class="small-button" @click="emit('login')">登录</button><button class="text-link" @click="emit('forum')">返回讨论广场</button></div></div>
    <template v-else>
      <div v-reveal class="log-summary">
        <div class="log-stat"><span>待审批申请</span><strong>{{ summary.pendingApplications }}</strong><small>需要管理员处理</small></div>
        <div class="log-stat"><span>最近 24 小时操作</span><strong>{{ summary.recentActions }}</strong><small>含审批、禁用和删帖</small></div>
        <div class="log-stat log-stat-action"><span>快捷入口</span><button class="small-button" @click="emit('admin')">进入管理台</button><small>处理申请与用户</small></div>
      </div>
      <p v-if="error" class="message-error" role="alert">{{ error }} <button class="text-link" @click="refresh">重新加载</button></p>

      <section v-reveal class="log-section" aria-labelledby="pending-title">
        <div class="log-section-heading"><div><h2 id="pending-title">待处理通知</h2><p>新的管理员申请会在这里出现。</p></div><button class="text-link" :disabled="loading || pendingLoading" @click="refresh">刷新</button></div>
        <p v-if="pendingLoading && !pending.length" class="quiet-state" role="status">正在读取待处理申请…</p>
        <p v-else-if="!pending.length" class="quiet-state">目前没有待审批的管理员申请。</p>
        <ul v-else class="log-list">
          <li v-for="(application, index) in pending" :key="application.id" v-reveal="{ delay: Math.min(index * 45, 180) }" class="log-item log-pending">
            <div class="log-item-head"><strong>{{ application.user.nickname }}</strong><span class="log-action">待审批</span><time>{{ displayTime(application.createdAt) }}</time></div>
            <p class="log-target">@{{ application.user.username }} · {{ application.user.status === 'active' ? '正常账号' : '已禁用' }}</p>
            <p class="log-reason">{{ application.statement }}</p>
            <div class="log-actions"><button class="small-button" @click="emit('admin')">去管理台审批</button></div>
          </li>
        </ul>
      </section>

      <section v-reveal class="log-section" aria-labelledby="audit-title">
        <div class="log-section-heading"><div><h2 id="audit-title">操作日志</h2><p>审批、禁用/恢复账号和管理员删帖都会留下记录。</p></div></div>
        <p v-if="loading" class="quiet-state" role="status">正在加载操作日志…</p>
        <p v-else-if="!logs.length" class="quiet-state">还没有管理员操作记录。</p>
        <ol v-else class="log-list">
          <li v-for="(item, index) in logs" :key="item.id" v-reveal="{ delay: Math.min(index * 40, 160) }" class="log-item">
            <div class="log-item-head"><strong>{{ item.actor.nickname }}</strong><span class="log-action" :class="actionTone(item.action)">{{ actionLabel(item.action) }}</span><time>{{ displayTime(item.createdAt) }}</time></div>
            <p class="log-target">{{ item.targetLabel }}</p>
            <p v-if="item.reason" class="log-reason">理由：{{ item.reason }}</p>
          </li>
        </ol>
        <button v-if="cursor" class="load-more" :disabled="loadingMore" @click="load(false)">{{ loadingMore ? '正在加载…' : '加载更早的日志' }}</button>
      </section>
    </template>
  </section>
</template>
