<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { restoreSession, user } from '../api'
import { applyForAdmin, getMyApplication, type AdminApplication } from '../adminApi'
import { displayTime, failureMessage } from '../forumTypes'
const emit = defineEmits<{ login: []; admin: [] }>()
const application = ref<AdminApplication | null>(null)
const loading = ref(false), loadError = ref(''), submitting = ref(false)
const statement = ref(''), error = ref(''), notice = ref('')
const length = computed(() => Array.from(statement.value.replace(/\r\n?/g, '\n').trim()).length)
const pending = computed(() => application.value?.status === 'pending')
const approved = computed(() => application.value?.status === 'approved')
const rejected = computed(() => application.value?.status === 'rejected')
const applicationCreatedAt = computed(() => application.value ? displayTime(application.value.createdAt) : '')
const applicationStatement = computed(() => application.value?.statement || '')
const applicationReason = computed(() => application.value?.reviewReason || '未填写')
async function load() {
  if (!user.value) { application.value = null; loadError.value = ''; return }
  loading.value = true; loadError.value = ''
  try {
    const data = await getMyApplication()
    application.value = data.application
    if (data.application?.status === 'approved' && user.value.role !== 'admin') {
      try { await restoreSession() } catch { /* The admin entry appears after a later session refresh. */ }
    }
  } catch (e) { loadError.value = failureMessage(e) }
  finally { loading.value = false }
}
async function refreshRole() {
  error.value = ''; notice.value = ''
  try { await restoreSession(); notice.value = user.value?.role === 'admin' ? '管理员权限已生效。' : '权限尚未更新，请稍后再试。' }
  catch (e) { error.value = failureMessage(e) }
}
async function submit() {
  if (!user.value) { emit('login'); return }
  if (submitting.value) return
  if (length.value < 1 || length.value > 500) { error.value = '申请理由需为 1～500 个字符。'; return }
  submitting.value = true; error.value = ''; notice.value = ''
  try {
    const data = await applyForAdmin(statement.value)
    application.value = data.application; statement.value = ''; notice.value = '申请已提交，请等待管理员审批。'
  } catch (e) { error.value = failureMessage(e) }
  finally { submitting.value = false }
}
watch(() => user.value?.id, () => { void load() }, { immediate: true })
</script>

<template>
  <section class="tools-page" aria-labelledby="tools-title">
    <div class="page-heading"><p lang="ja">ちょっと寄り道 (´▽`)</p><h1 id="tools-title">工具</h1><span>导航、权限申请与一些之后会慢慢补上的小工具</span></div>
    <div class="tool-grid">
      <section class="tool-card gal-card" aria-labelledby="gal-title">
        <span class="tool-mark" aria-hidden="true">⌘</span>
        <p class="side-kicker" lang="ja">gal navigation</p>
        <h2 id="gal-title">gal 导航</h2>
        <p>把喜欢的作品、资源和同好站点收在一处。导航链接正在整理中，之后会在这里开放。</p>
        <button class="text-link" type="button" disabled>链接准备中</button>
      </section>

      <section class="tool-card" aria-labelledby="apply-title">
        <span class="tool-mark" aria-hidden="true">✦</span>
        <p class="side-kicker" lang="ja">admin application</p>
        <h2 id="apply-title">申请管理员权限</h2>
        <p v-if="!user">登录后可以提交管理员申请，由现有管理员审批。</p>
        <button v-if="!user" class="small-button" type="button" @click="emit('login')">登录后申请</button>

        <template v-else-if="user.role === 'admin'">
          <p>你已经是管理员，可以直接进入管理台处理申请与用户。</p>
          <button class="small-button" type="button" @click="emit('admin')">进入管理台</button>
        </template>

        <template v-else-if="loading"><p class="quiet-state" role="status">正在读取申请状态…</p></template>

        <template v-else-if="loadError">
          <p class="message-error" role="alert">{{ loadError }}</p>
          <button class="text-link" type="button" @click="load">重新读取</button>
        </template>

        <template v-else-if="pending">
          <p class="application-status"><span class="status-dot" aria-hidden="true"></span>审核中</p>
          <p class="application-meta">提交于 {{ applicationCreatedAt }}。审批结果会在这里显示。</p>
          <p class="application-statement">{{ applicationStatement }}</p>
        </template>

        <template v-else-if="approved">
          <p class="application-status is-approved">已通过</p>
          <p class="application-meta">管理员权限已批准。如果导航栏还没有管理入口，刷新一次权限即可。</p>
          <button class="small-button" type="button" @click="refreshRole">刷新权限</button>
        </template>

        <template v-else>
          <p v-if="rejected" class="application-status is-rejected">已拒绝</p>
          <p v-if="rejected" class="application-meta">审批理由：{{ applicationReason }}</p>
          <form class="application-form" @submit.prevent="submit">
            <label for="admin-statement">{{ rejected ? '重新说明你的申请理由' : '申请理由' }}</label>
            <textarea id="admin-statement" v-model="statement" maxlength="500" rows="4" placeholder="简单介绍你希望参与管理的原因，以及你能负责的部分。" :disabled="submitting"></textarea>
            <div class="application-form-bottom"><span :class="{ 'over-limit': length > 500 }">{{ length }} / 500 字</span><button class="small-button" :disabled="submitting || !length || length > 500">{{ submitting ? '正在提交…' : '提交申请' }}</button></div>
          </form>
        </template>

        <p v-if="notice" class="action-notice" role="status">{{ notice }}</p>
        <p v-if="error" class="message-error" role="alert">{{ error }}</p>
      </section>
    </div>
  </section>
</template>
