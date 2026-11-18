<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { user, type User } from '../api'
import {
  deleteAdminMessage, getAdminApplications, getAdminUsers, getRecentMessages,
  reviewAdminApplication, setUserStatus, type AdminApplication
} from '../adminApi'
import type { Message } from '../useMessages'
import { displayTime, failureMessage } from '../forumTypes'
const emit = defineEmits<{ login: []; forum: [] }>()
type Tab = 'applications' | 'users' | 'messages'
const tab = ref<Tab>('applications'), applicationFilter = ref<'pending' | 'all'>('pending')
const applications = ref<AdminApplication[]>([]), applicationsLoading = ref(false), applicationsError = ref('')
const users = ref<User[]>([]), usersLoading = ref(false), usersError = ref(''), userQuery = ref(''), userStatus = ref<'' | 'active' | 'disabled'>('')
const messages = ref<Message[]>([]), messagesLoading = ref(false), messagesError = ref('')
const error = ref(''), notice = ref('')
const reviewTarget = ref<AdminApplication | null>(null), reviewDecision = ref<'approve' | 'reject'>('approve'), reviewReason = ref(''), reviewing = ref(false)
const userTarget = ref<User | null>(null), userTargetStatus = ref<'active' | 'disabled'>('disabled'), userReason = ref(''), userSaving = ref(false)
const messageTarget = ref<Message | null>(null), messageReason = ref(''), messageDeleting = ref(false)
const isAdmin = computed(() => user.value?.role === 'admin')

async function loadApplications() {
  applicationsLoading.value = true; applicationsError.value = ''
  try { applications.value = (await getAdminApplications(applicationFilter.value === 'pending' ? 'pending' : undefined)).data }
  catch (e) { applicationsError.value = failureMessage(e) }
  finally { applicationsLoading.value = false }
}
async function loadUsers() {
  usersLoading.value = true; usersError.value = ''
  try { users.value = (await getAdminUsers({ q: userQuery.value.trim() || undefined, status: userStatus.value || undefined })).data }
  catch (e) { usersError.value = failureMessage(e) }
  finally { usersLoading.value = false }
}
async function loadMessages() {
  messagesLoading.value = true; messagesError.value = ''
  try { messages.value = await getRecentMessages() }
  catch (e) { messagesError.value = failureMessage(e) }
  finally { messagesLoading.value = false }
}
function loadAll() {
  error.value = ''; notice.value = ''
  if (!isAdmin.value) return
  void loadApplications(); void loadUsers(); void loadMessages()
}
watch(() => user.value?.role, role => { if (role === 'admin') loadAll() }, { immediate: true })

function startReview(application: AdminApplication, decision: 'approve' | 'reject') {
  reviewTarget.value = application; reviewDecision.value = decision; reviewReason.value = ''; error.value = ''
}
async function submitReview() {
  if (!reviewTarget.value || reviewing.value) return
  const reason = reviewReason.value.replace(/\r\n?/g, '\n').trim()
  if (reviewDecision.value === 'reject' && !reason) { error.value = '拒绝申请时请填写理由。'; return }
  reviewing.value = true; error.value = ''
  try {
    await reviewAdminApplication(reviewTarget.value.id, reviewDecision.value, reason)
    notice.value = reviewDecision.value === 'approve' ? '申请已通过，用户已成为管理员。' : '申请已拒绝。'
    reviewTarget.value = null; await loadApplications()
  } catch (e) { error.value = failureMessage(e) }
  finally { reviewing.value = false }
}

function startUserAction(target: User, status: 'active' | 'disabled') {
  userTarget.value = target; userTargetStatus.value = status; userReason.value = status === 'disabled' ? '' : '恢复账号'; error.value = ''
}
async function submitUserAction() {
  if (!userTarget.value || userSaving.value) return
  const reason = userReason.value.replace(/\r\n?/g, '\n').trim()
  if (!reason) { error.value = '请填写操作理由。'; return }
  userSaving.value = true; error.value = ''
  try {
    const data = await setUserStatus(userTarget.value.id, userTargetStatus.value, reason)
    users.value = users.value.map(item => item.id === data.user.id ? data.user : item)
    notice.value = userTargetStatus.value === 'disabled' ? '账号已禁用，相关会话已撤销。' : '账号已恢复。'
    userTarget.value = null
  } catch (e) { error.value = failureMessage(e) }
  finally { userSaving.value = false }
}

function startMessageDelete(target: Message) {
  messageTarget.value = target; messageReason.value = ''; error.value = ''
}
async function submitMessageDelete() {
  if (!messageTarget.value || messageDeleting.value) return
  const reason = messageReason.value.replace(/\r\n?/g, '\n').trim()
  if (!reason) { error.value = '请填写删除理由。'; return }
  const id = messageTarget.value.id
  messageDeleting.value = true; error.value = ''
  try {
    await deleteAdminMessage(id, reason)
    messages.value = messages.value.filter(item => item.id !== id)
    notice.value = '帖子已由管理员删除。'; messageTarget.value = null
  } catch (e) { error.value = failureMessage(e) }
  finally { messageDeleting.value = false }
}
</script>

<template>
  <section class="admin-page" aria-labelledby="admin-title">
    <div class="page-heading"><p lang="ja">management room</p><h1 id="admin-title">管理台</h1><span>处理管理员申请、账号状态与公开帖子</span></div>
    <div v-if="!isAdmin" class="admin-guard">
      <span class="tool-mark" aria-hidden="true">✦</span>
      <h2>{{ user ? '需要管理员权限' : '请先登录管理员账号' }}</h2>
      <p>{{ user ? '当前账号不是管理员，无法进入管理台。' : '登录后，只有管理员账号才能进入这里。' }}</p>
      <div class="admin-guard-actions"><button v-if="!user" class="small-button" @click="emit('login')">登录</button><button class="text-link" @click="emit('forum')">返回讨论广场</button></div>
    </div>
    <template v-else>
      <div class="admin-toolbar">
        <div class="admin-tabs" role="tablist" aria-label="管理台分类"><button :class="{ selected: tab === 'applications' }" role="tab" :aria-selected="tab === 'applications'" @click="tab = 'applications'">管理员申请</button><button :class="{ selected: tab === 'users' }" role="tab" :aria-selected="tab === 'users'" @click="tab = 'users'">用户</button><button :class="{ selected: tab === 'messages' }" role="tab" :aria-selected="tab === 'messages'" @click="tab = 'messages'">帖子</button></div>
        <button class="text-link" :disabled="applicationsLoading || usersLoading || messagesLoading" @click="loadAll">刷新</button>
      </div>
      <p v-if="error" class="message-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="action-notice" role="status">{{ notice }}</p>

      <section v-if="tab === 'applications'" class="admin-section" aria-labelledby="admin-applications-title">
        <div class="admin-section-heading"><div><h2 id="admin-applications-title">管理员申请</h2><p>通过后，用户会获得完整管理员权限；拒绝时必须填写理由。</p></div><div class="admin-filters"><button :class="{ selected: applicationFilter === 'pending' }" @click="applicationFilter = 'pending'; loadApplications()">待审批</button><button :class="{ selected: applicationFilter === 'all' }" @click="applicationFilter = 'all'; loadApplications()">全部</button></div></div>
        <p v-if="applicationsError" class="message-error" role="alert">{{ applicationsError }} <button class="text-link" @click="loadApplications">重试</button></p>
        <p v-else-if="applicationsLoading" class="quiet-state" role="status">正在加载申请…</p>
        <p v-else-if="!applications.length" class="quiet-state">暂时没有{{ applicationFilter === 'pending' ? '待审批' : '' }}申请。</p>
        <ul v-else class="admin-list">
          <li v-for="application in applications" :key="application.id" class="admin-item">
            <div class="admin-item-head"><div><strong>{{ application.user.nickname }}</strong> <span class="admin-muted">@{{ application.user.username }} · {{ application.user.status === 'active' ? '正常' : '已禁用' }}</span></div><span class="application-status" :class="{ 'is-approved': application.status === 'approved', 'is-rejected': application.status === 'rejected' }">{{ application.status === 'pending' ? '待审批' : application.status === 'approved' ? '已通过' : '已拒绝' }}</span></div>
            <p class="admin-statement">{{ application.statement }}</p>
            <p class="admin-meta">提交于 {{ displayTime(application.createdAt) }}<template v-if="application.reviewedAt"> · 审批于 {{ displayTime(application.reviewedAt) }} · {{ application.reviewReason || '无备注' }}</template></p>
            <div v-if="application.status === 'pending'" class="admin-actions"><button class="small-button" @click="startReview(application, 'approve')">通过</button><button class="admin-danger" @click="startReview(application, 'reject')">拒绝</button></div>
          </li>
        </ul>
      </section>

      <section v-if="tab === 'users'" class="admin-section" aria-labelledby="admin-users-title">
        <div class="admin-section-heading"><div><h2 id="admin-users-title">用户</h2><p>禁用会立即撤销该用户的全部会话；恢复不会恢复旧会话。</p></div></div>
        <form class="admin-search" @submit.prevent="loadUsers"><label class="sr-only" for="admin-user-search">搜索用户名或昵称</label><input id="admin-user-search" v-model="userQuery" maxlength="64" placeholder="搜索用户名或昵称"><select v-model="userStatus" aria-label="账号状态筛选"><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option></select><button class="small-button" :disabled="usersLoading">搜索</button></form>
        <p v-if="usersError" class="message-error" role="alert">{{ usersError }} <button class="text-link" @click="loadUsers">重试</button></p>
        <p v-else-if="usersLoading" class="quiet-state" role="status">正在加载用户…</p>
        <p v-else-if="!users.length" class="quiet-state">没有符合条件的用户。</p>
        <ul v-else class="admin-list">
          <li v-for="item in users" :key="item.id" class="admin-item admin-user-item">
            <div class="admin-item-head"><div><strong>{{ item.nickname }}</strong> <span class="admin-muted">@{{ item.username }}</span></div><span class="admin-role">{{ item.role === 'admin' ? '管理员' : '普通用户' }} · {{ item.status === 'active' ? '正常' : '已禁用' }}</span></div>
            <p class="admin-meta">注册于 {{ displayTime(item.createdAt) }}</p>
            <div class="admin-actions"><button v-if="item.status === 'active'" class="admin-danger" @click="startUserAction(item, 'disabled')">禁用</button><button v-else class="small-button" @click="startUserAction(item, 'active')">恢复</button></div>
          </li>
        </ul>
      </section>

      <section v-if="tab === 'messages'" class="admin-section" aria-labelledby="admin-messages-title">
        <div class="admin-section-heading"><div><h2 id="admin-messages-title">公开帖子</h2><p>显示最近 50 条公开帖子；管理员删除会写审计日志并广播删除事件。</p></div></div>
        <p v-if="messagesError" class="message-error" role="alert">{{ messagesError }} <button class="text-link" @click="loadMessages">重试</button></p>
        <p v-else-if="messagesLoading" class="quiet-state" role="status">正在加载帖子…</p>
        <p v-else-if="!messages.length" class="quiet-state">目前没有公开帖子。</p>
        <ul v-else class="admin-list">
          <li v-for="item in messages" :key="item.id" class="admin-item">
            <div class="admin-item-head"><div><strong>{{ item.author.nickname }}</strong> <span class="admin-muted">#{{ item.tag || 'daily' }}</span></div><time class="admin-meta" :datetime="item.createdAt">{{ displayTime(item.createdAt) }}</time></div>
            <p class="admin-statement">{{ item.body }}</p>
            <div class="admin-actions"><button class="admin-danger" @click="startMessageDelete(item)">管理员删除</button></div>
          </li>
        </ul>
      </section>
    </template>

    <div v-if="reviewTarget" class="admin-review" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div class="admin-review-body">
        <h2 id="review-title">{{ reviewDecision === 'approve' ? '通过管理员申请' : '拒绝管理员申请' }}</h2>
        <p>申请人：<strong>{{ reviewTarget.user.nickname }}</strong>（@{{ reviewTarget.user.username }}）</p>
        <p class="admin-statement">{{ reviewTarget.statement }}</p>
        <label for="review-reason">{{ reviewDecision === 'reject' ? '拒绝理由（必填）' : '备注（可选）' }}</label>
        <textarea id="review-reason" v-model="reviewReason" maxlength="500" rows="3" :disabled="reviewing"></textarea>
        <div class="admin-actions"><button class="small-button" :disabled="reviewing" @click="submitReview">{{ reviewing ? '正在处理…' : reviewDecision === 'approve' ? '确认通过' : '确认拒绝' }}</button><button :disabled="reviewing" @click="reviewTarget = null">取消</button></div>
      </div>
    </div>

    <div v-if="userTarget" class="admin-review" role="dialog" aria-modal="true" aria-labelledby="user-action-title">
      <div class="admin-review-body">
        <h2 id="user-action-title">{{ userTargetStatus === 'disabled' ? '禁用账号' : '恢复账号' }}：{{ userTarget.nickname }}</h2>
        <p>禁用会立即撤销该用户的全部会话；恢复后需要重新登录。</p>
        <label for="user-action-reason">操作理由（必填）</label>
        <textarea id="user-action-reason" v-model="userReason" maxlength="500" rows="3" :disabled="userSaving"></textarea>
        <div class="admin-actions"><button class="small-button" :disabled="userSaving" @click="submitUserAction">{{ userSaving ? '正在处理…' : '确认' }}</button><button :disabled="userSaving" @click="userTarget = null">取消</button></div>
      </div>
    </div>

    <div v-if="messageTarget" class="admin-review" role="dialog" aria-modal="true" aria-labelledby="message-action-title">
      <div class="admin-review-body">
        <h2 id="message-action-title">管理员删除帖子</h2>
        <p class="admin-statement">{{ messageTarget.body }}</p>
        <label for="message-action-reason">删除理由（必填）</label>
        <textarea id="message-action-reason" v-model="messageReason" maxlength="500" rows="3" :disabled="messageDeleting"></textarea>
        <div class="admin-actions"><button class="admin-danger" :disabled="messageDeleting" @click="submitMessageDelete">{{ messageDeleting ? '正在删除…' : '确认删除' }}</button><button :disabled="messageDeleting" @click="messageTarget = null">取消</button></div>
      </div>
    </div>
  </section>
</template>
