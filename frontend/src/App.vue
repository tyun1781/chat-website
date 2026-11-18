<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ApiError, clearSession, login, request, restoreSession, sessionNotice, user, type User } from './api'
import ForumHome from './components/ForumHome.vue'
import InboxPanel from './components/InboxPanel.vue'
import AccountHome from './components/AccountHome.vue'
import ToolsPage from './components/ToolsPage.vue'
import AboutPage from './components/AboutPage.vue'
import AdminPanel from './components/AdminPanel.vue'
import NotificationsPanel from './components/NotificationsPanel.vue'
import GalNavPage from './components/GalNavPage.vue'
import AdminLogPage from './components/AdminLogPage.vue'
import { usePresence } from './usePresence'
import { clearNotifications, refreshUnread, unreadNotifications } from './notificationsApi'
import type { Person } from './forumTypes'
type Panel = 'login' | 'register' | 'profile' | 'password' | null
let previouslyEntered = false
try { previouslyEntered = sessionStorage.getItem('board-entered') === 'yes' } catch { /* storage is optional */ }
const entered = ref(previouslyEntered)
const panel = ref<Panel>(null)
const dialog = ref<HTMLDialogElement>()
const username = ref(''), password = ref(''), nickname = ref(''), currentPassword = ref(''), newPassword = ref('')
const busy = ref(false), restoring = ref(true), error = ref(''), notice = ref(''), connectionError = ref('')
const fields = ref<Record<string, string>>({})
const view = ref<'forum' | 'inbox' | 'home' | 'tools' | 'about' | 'admin' | 'notifications' | 'gal' | 'logs'>('forum')
const presence = usePresence()
const recipient = ref<Person | null>(null)
function openChat(person: Person) {
  if (!user.value) { open('login'); return }
  recipient.value = person; view.value = 'inbox'
}
function openInbox() { recipient.value = null; view.value = 'inbox' }
const titles = { login: '欢迎回来', register: '认识一下吧', profile: '你的个人资料', password: '修改密码' }
const title = computed(() => panel.value ? titles[panel.value] : '')
function enter() {
  if (entered.value) return
  entered.value = true
  try { sessionStorage.setItem('board-entered', 'yes') } catch { /* private browsing */ }
  nextTick(() => document.querySelector<HTMLElement>('#main-title')?.focus())
}
function onKey(event: KeyboardEvent) { if (!entered.value && event.key === 'Enter') { event.preventDefault(); enter() } }
function open(next: Panel) {
  error.value = ''; fields.value = {}; notice.value = ''; password.value = ''; currentPassword.value = ''; newPassword.value = ''
  nickname.value = user.value?.nickname || ''
  panel.value = next
  nextTick(() => { if (!dialog.value?.open) dialog.value?.showModal() })
}
function close() { if (busy.value) return; dialog.value?.close(); panel.value = null; password.value = ''; currentPassword.value = ''; newPassword.value = '' }
function report(e: unknown) { error.value = e instanceof Error ? e.message : '操作失败，请重试。'; fields.value = e instanceof ApiError ? e.fields : {} }
async function submit() {
  if (busy.value) return
  error.value = ''; fields.value = {}; busy.value = true
  try {
    if (panel.value === 'register') {
      await request('/auth/register', 'POST', { username: username.value.trim().toLowerCase(), password: password.value, nickname: nickname.value.trim() })
      panel.value = 'login'; password.value = ''; notice.value = '注册成功，请使用刚刚创建的账号登录。'
    } else if (panel.value === 'login') {
      await login(username.value.trim().toLowerCase(), password.value)
      notice.value = '登录成功，欢迎回来。'; busy.value = false; close()
    } else if (panel.value === 'profile') {
      const data = await request<{ user: User }>('/users/me', 'PATCH', { nickname: nickname.value.trim() })
      user.value = data.user; notice.value = '昵称已保存。'; busy.value = false; close()
    } else if (panel.value === 'password') {
      await request('/users/me/password', 'POST', { currentPassword: currentPassword.value, newPassword: newPassword.value })
      clearSession(); panel.value = 'login'; currentPassword.value = ''; newPassword.value = ''; password.value = ''; notice.value = '密码已修改，所有设备已退出。请使用新密码登录。'
    }
  } catch (e) { report(e) } finally { busy.value = false }
}
async function logout() {
  if (busy.value) return
  busy.value = true
  try { await request('/auth/logout', 'POST'); clearSession(); clearNotifications(); notice.value = '已退出登录。'; if (view.value === 'admin' || view.value === 'notifications' || view.value === 'logs') view.value = 'forum' }
  catch (e) { notice.value = e instanceof Error ? e.message : '退出失败，请重试。' }
  finally { busy.value = false }
}
async function restore() {
  restoring.value = true; connectionError.value = ''
  try { await restoreSession() }
  catch (e) { if (!(e instanceof ApiError && e.code === 'UNAUTHENTICATED')) connectionError.value = e instanceof Error ? e.message : '无法恢复登录状态。' }
  finally { restoring.value = false }
}
watch(panel, () => nextTick(() => dialog.value?.querySelector<HTMLInputElement>('input')?.focus()))
watch(entered, value => { document.body.style.overflow = value ? '' : 'hidden' })
let unreadTimer: ReturnType<typeof setInterval> | null = null
watch(() => user.value?.id, id => {
  if (id) {
    void refreshUnread()
    if (!unreadTimer) unreadTimer = setInterval(() => { void refreshUnread() }, 30000)
  } else {
    clearNotifications()
    if (unreadTimer) { clearInterval(unreadTimer); unreadTimer = null }
  }
}, { immediate: true })
onMounted(() => { document.addEventListener('keydown', onKey); document.body.style.overflow = entered.value ? '' : 'hidden'; void restore() })
onUnmounted(() => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; if (unreadTimer) clearInterval(unreadTimer) })
</script>

<template>
  <Transition name="entrance">
    <button v-if="!entered" class="entry" @click="enter" aria-label="点击任意处进入讨论区">
      <picture class="welcome-background" aria-hidden="true"><source media="(max-width: 600px)" srcset="/images/sora-welcome-mobile.jpg"><img src="/images/sora-welcome-aqua.jpg" alt="" fetchpriority="high"></picture>
      <span class="welcome-shade" aria-hidden="true"></span>
      <span class="entry-kicker">Welcome to</span>
      <span class="entry-title">INCH<span class="entry-greeting">Ciallo (∠・ω&lt;)⌒☆</span></span>
      <span class="entry-action">点击任意处进入</span>
      <span class="entry-key">也可以按回车键</span>
    </button>
  </Transition>
  <div class="site" :inert="!entered" :aria-hidden="!entered">
    <header class="header">
      <a class="wordmark" href="#" aria-label="INCH 返回讨论广场" @click.prevent="view = 'forum'"><span class="logo" aria-hidden="true">✦</span><span>INCH<small lang="ja">ここで、ひとやすみ。</small></span></a>
      <nav class="main-nav" aria-label="主导航"><button :class="{ selected: view === 'home' }" :aria-current="view === 'home' ? 'page' : undefined" @click="view = 'home'">主页</button><button :class="{ selected: view === 'tools' }" :aria-current="view === 'tools' ? 'page' : undefined" @click="view = 'tools'">工具</button><button :class="{ selected: view === 'about' }" :aria-current="view === 'about' ? 'page' : undefined" @click="view = 'about'">关于作者</button><span class="nav-separator" aria-hidden="true"></span><button :class="{ selected: view === 'forum' }" :aria-current="view === 'forum' ? 'page' : undefined" @click="view = 'forum'">广场</button><button :class="{ selected: view === 'inbox' }" :aria-current="view === 'inbox' ? 'page' : undefined" @click="openInbox">私聊</button><button v-if="user" :class="{ selected: view === 'notifications' }" :aria-current="view === 'notifications' ? 'page' : undefined" @click="view = 'notifications'">通知<span v-if="unreadNotifications" class="nav-badge">{{ unreadNotifications > 99 ? '99+' : unreadNotifications }}</span></button><button v-if="user?.role === 'admin'" :class="{ selected: view === 'admin' }" :aria-current="view === 'admin' ? 'page' : undefined" @click="view = 'admin'">管理</button><button v-if="user?.role === 'admin'" :class="{ selected: view === 'logs' }" :aria-current="view === 'logs' ? 'page' : undefined" @click="view = 'logs'">日志通知</button></nav>
      <nav class="account-nav" aria-label="账号导航">
        <span class="presence-indicator" :class="{ unavailable: presence.unavailable.value }" role="status" title="当前保持连接的访客浏览器数量，同一浏览器去重">{{ presence.label.value }}</span>
        <span v-if="restoring" class="muted" role="status">正在恢复登录…</span>
        <template v-else-if="user"><button class="account-button" @click="view = 'home'">{{ user.nickname }}</button><button class="text-button" :disabled="busy" @click="logout">退出</button></template>
        <template v-else><button class="text-button" @click="open('login')">登录</button><button class="small-button" @click="open('register')">注册</button></template>
      </nav>
    </header>
    <main>
      <div v-if="sessionNotice" class="banner warning" role="alert">{{ sessionNotice }} <button @click="open('login')">重新登录</button></div>
      <div v-if="connectionError" class="banner warning" role="alert">{{ connectionError }} <button :disabled="restoring" @click="restore">重试连接</button></div>
      <div v-if="notice && !panel" class="banner" role="status">{{ notice }}</div>
      <ForumHome v-show="view === 'forum'" :active="view === 'forum' && entered" :restoring="restoring" @login="open('login')" @profile="open('profile')" @chat="openChat" @inbox="openInbox" />
      <InboxPanel v-if="view === 'inbox'" :recipient="recipient" @login="open('login')" @opened="recipient = null" />
      <AccountHome v-if="view === 'home'" @login="open('login')" @register="open('register')" @nickname="open('profile')" @password="open('password')" @forum="view = 'forum'" />
      <ToolsPage v-if="view === 'tools'" @login="open('login')" @admin="view = 'admin'" @gal="view = 'gal'" />
      <GalNavPage v-if="view === 'gal'" @back="view = 'tools'" />
      <AboutPage v-if="view === 'about'" @forum="view = 'forum'" />
      <AdminPanel v-if="view === 'admin'" @login="open('login')" @forum="view = 'forum'" />
      <AdminLogPage v-if="view === 'logs'" @login="open('login')" @admin="view = 'admin'" @forum="view = 'forum'" />
      <NotificationsPanel v-if="view === 'notifications'" @login="open('login')" @forum="view = 'forum'" />
    </main>
    <footer><span class="footer-brand">INCH <span lang="ja">またね ( ´ ▽ ` )ﾉ</span></span><span>inch.zy <a href="https://github.com/tyun1781/chat-website" target="_blank" rel="noopener noreferrer">GitHub?</a></span></footer>
  </div>
  <dialog ref="dialog" class="account-dialog" aria-labelledby="account-title" @cancel.prevent="close" @click="event => { if (event.target === dialog) close() }">
    <div class="dialog-body">
      <button class="close-button" aria-label="关闭账号窗口" :disabled="busy" @click="close">×</button>
      <h2 id="account-title">{{ title }}</h2><p class="dialog-intro">{{ panel === 'register' ? '一个账号，一点属于你的声音。' : panel === 'login' ? '登录后，继续你的交流。' : '让大家更好地认识你。' }}</p>
      <div v-if="notice" class="form-notice" role="status">{{ notice }}</div>
      <div v-if="error" class="form-error" role="alert">{{ error }}<ul v-if="Object.keys(fields).length"><li v-for="(message, name) in fields" :key="name">{{ message }}</li></ul><button v-if="!user && (panel === 'profile' || panel === 'password')" type="button" @click="open('login')">重新登录</button></div>
      <form @submit.prevent="submit">
        <fieldset :disabled="busy">
          <template v-if="panel === 'register' || panel === 'login'">
            <label for="username">用户名</label><input id="username" v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_]{3,32}" aria-describedby="username-hint"><p id="username-hint" class="field-hint">3～32 位英文字母、数字或下划线。</p>
          </template>
          <template v-if="panel === 'register' || panel === 'profile'">
            <label for="nickname">公开昵称</label><input id="nickname" v-model="nickname" autocomplete="nickname" required maxlength="64" aria-describedby="nickname-hint"><p id="nickname-hint" class="field-hint">1～32 个字，所有访客可见。</p>
          </template>
          <template v-if="panel === 'register' || panel === 'login'">
            <label for="password">密码</label><input id="password" v-model="password" type="password" :autocomplete="panel === 'register' ? 'new-password' : 'current-password'" required :minlength="panel === 'register' ? 12 : undefined" maxlength="128" aria-describedby="password-hint"><p id="password-hint" class="field-hint">{{ panel === 'register' ? '12～128 个字符，建议使用不易猜测的长密码。' : '请输入你的账号密码。' }}</p>
          </template>
          <template v-if="panel === 'profile'"><p class="account-name">用户名：{{ user?.username }}</p><button type="button" class="text-link" @click="open('password')">修改密码</button></template>
          <template v-if="panel === 'password'">
            <label for="current-password">当前密码</label><input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required maxlength="128">
            <label for="new-password">新密码</label><input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="new-password-hint"><p id="new-password-hint" class="field-hint">12～128 个字符。修改后所有设备需重新登录。</p>
          </template>
          <button class="primary-button submit" type="submit">{{ busy ? '正在处理…' : panel === 'register' ? '创建账号' : panel === 'login' ? '登录' : panel === 'profile' ? '保存昵称' : '修改密码并退出' }}</button>
        </fieldset>
      </form>
      <p v-if="panel === 'login'" class="switch-panel">还没有账号？<button :disabled="busy" @click="open('register')">创建账号</button></p>
      <p v-if="panel === 'register'" class="switch-panel">已有账号？<button :disabled="busy" @click="open('login')">去登录</button></p>
    </div>
  </dialog>
</template>
