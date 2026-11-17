<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ApiError, clearSession, login, request, restoreSession, sessionNotice, user, type User } from './api'
type Panel = 'login' | 'register' | 'profile' | 'password' | null
let previouslyEntered = false
try { previouslyEntered = sessionStorage.getItem('board-entered') === 'yes' } catch { /* storage is optional */ }
const entered = ref(previouslyEntered)
const panel = ref<Panel>(null)
const dialog = ref<HTMLDialogElement>()
const username = ref(''), password = ref(''), nickname = ref(''), currentPassword = ref(''), newPassword = ref('')
const busy = ref(false), restoring = ref(true), error = ref(''), notice = ref(''), connectionError = ref('')
const fields = ref<Record<string, string>>({})
const draft = ref('')
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
  try { await request('/auth/logout', 'POST'); clearSession(); notice.value = '已退出登录。' }
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
onMounted(() => { document.addEventListener('keydown', onKey); void restore() })
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="entrance">
    <button v-if="!entered" class="entry" @click="enter" aria-label="点击任意处进入留言板">
      <span class="entry-brand">一处放下想法的地方</span>
      <span class="entry-paper"><span>你好，<br>过路的人。</span><span class="entry-smile" aria-hidden="true">☺</span></span>
      <span class="entry-action">点击任意处进入 <span aria-hidden="true">↗</span></span>
      <span class="entry-key">也可以按回车键</span>
    </button>
  </Transition>
  <div class="site" :inert="!entered" :aria-hidden="!entered">
    <header class="header">
      <a class="wordmark" href="#" aria-label="留个言吧首页"><span class="logo" aria-hidden="true">言</span>留个言吧</a>
      <nav aria-label="账号导航">
        <span v-if="restoring" class="muted" role="status">正在恢复登录…</span>
        <template v-else-if="user">
          <button class="account-button" @click="open('profile')">{{ user.nickname }}<span class="account-dot" aria-hidden="true"></span></button>
          <button class="text-button" :disabled="busy" @click="logout">退出</button>
        </template>
        <template v-else><button class="text-button" @click="open('login')">登录</button><button class="small-button" @click="open('register')">创建账号</button></template>
      </nav>
    </header>
    <main>
      <section class="hero" aria-labelledby="main-title">
        <div><h1 id="main-title" tabindex="-1">留个言吧。</h1><p>今天的心情，突然的灵感，<br>或者，一句简单的你好。</p></div>
        <div class="hero-note" aria-hidden="true"><span>让想法<br>在这里相遇</span><svg viewBox="0 0 120 60"><path d="M8 12 C30 60 85 55 108 10 M91 17 L110 7 L112 29" /></svg></div>
      </section>
      <div v-if="sessionNotice" class="banner warning" role="alert">{{ sessionNotice }} <button @click="open('login')">重新登录</button></div>
      <div v-if="connectionError" class="banner warning" role="alert">{{ connectionError }} <button :disabled="restoring" @click="restore">重试连接</button></div>
      <div v-if="notice && !panel" class="banner" role="status">{{ notice }}</div>
      <div class="board-layout">
        <section class="conversation" aria-labelledby="board-title">
          <div class="section-heading"><h2 id="board-title">大家的留言</h2><span class="status-label">即将开放</span></div>
          <div class="empty-state"><div class="empty-bubble" aria-hidden="true"><span></span><span></span><span></span></div><h3>留一个位置，给你的声音。</h3><p>留言区正在准备中。<br>现在可以创建账号，选一个喜欢的昵称。</p><button v-if="!user" class="text-link" @click="open('register')">创建我的账号</button><p v-else class="welcome-note">{{ user.nickname }}，很高兴在这里遇见你。</p></div>
        </section>
        <aside class="write-area" aria-labelledby="write-title">
          <div class="paper"><div class="paper-top"><h2 id="write-title">想说点什么？</h2><span aria-hidden="true">✳</span></div><p class="composer-note">{{ user ? `以 ${user.nickname} 的身份` : '登录后，让大家认识你。' }}</p>
            <label class="sr-only" for="draft">留言草稿（暂不支持发布）</label><textarea id="draft" v-model="draft" maxlength="1000" placeholder="先把想法写在这里…" aria-describedby="draft-help" rows="5"></textarea>
            <div class="draft-meta"><span>本页临时草稿</span><span>{{ Array.from(draft).length }} 字</span></div>
            <button class="primary-button publish" disabled>留言功能即将开放</button><p id="draft-help" class="draft-help">暂不能发布或保存，刷新后草稿会清空。</p>
          </div>
          <div class="community-note"><h3>在这里，轻松一点。</h3><p>友善交流，尊重不同的想法。<br>请勿公开个人隐私或他人的信息。</p></div>
        </aside>
      </div>
    </main>
    <footer><span>留个言吧</span><span>每一句话，都有人听见。</span></footer>
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
