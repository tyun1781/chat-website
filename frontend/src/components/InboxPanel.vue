<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { user } from '../api'
import { useInbox } from '../useInbox'
import { displayTime, type Person } from '../forumTypes'
const props = defineProps<{ recipient: Person | null }>()
const emit = defineEmits<{ login: []; opened: [] }>()
const { conversations, active, messages, results, query, draft, error, searchError, notice, loading, searching, opening, loadingMessages, sending, moreConversations, moreMessages, status, length, search, select, openConversation, send, loadMessages, loadConversations, start } = useInbox()
const history = ref<HTMLElement>(), hasSelected = ref(false)
watch(() => props.recipient, async person => { if (person && user.value) { await openConversation(person); hasSelected.value = !!active.value; emit('opened') } }, { immediate: true })
watch(active, value => { if (value) { hasSelected.value = true; nextTick(() => history.value?.scrollTo({ top: history.value.scrollHeight })) } })
watch(() => messages.value.at(-1)?.id, () => { nextTick(() => { if (history.value) history.value.scrollTop = history.value.scrollHeight }) })
</script>
<template>
  <section class="inbox" aria-labelledby="inbox-title">
    <div class="inbox-heading"><div><h1 id="inbox-title">悄悄话信箱</h1><p>把话题留给彼此，不会出现在公开讨论区。</p></div><span v-if="user" class="status-label" role="status">{{ status }}</span></div>
    <div v-if="!user" class="inbox-login"><span class="letter-icon" aria-hidden="true">✉</span><h2>你的专属聊天空间</h2><p>登录后，搜索昵称或点击帖子作者，即可发起一对一私聊。</p><button class="primary-button" @click="emit('login')">登录，打开信箱</button></div>
    <template v-else>
      <p v-if="error" class="message-error" role="alert">{{ error }} <button class="text-link" @click="active ? loadMessages() : start()">重试</button></p>
      <div class="inbox-layout" :class="{ 'has-selection': hasSelected && active }">
        <aside class="inbox-list" aria-label="私聊列表">
          <form class="user-search" @submit.prevent="search"><label class="sr-only" for="people-search">搜索用户昵称</label><input id="people-search" v-model="query" maxlength="64" placeholder="搜索昵称，认识同好" autocomplete="off"><button :disabled="searching || !query.trim() || Array.from(query.trim()).length > 32">{{ searching ? '查找中' : '搜索' }}</button></form>
          <p v-if="searchError" class="search-error" role="status">{{ searchError }}</p>
          <ul v-if="results.length" class="search-results"><li v-for="person in results" :key="person.id"><button :disabled="opening || sending" @click="openConversation(person)"><span class="avatar">{{ Array.from(person.nickname)[0] }}</span><span>{{ person.nickname }}</span><small>发起私聊</small></button></li></ul>
          <h2 class="inbox-list-title">我的会话</h2><p v-if="loading && !conversations.length" class="quiet-state">正在打开信箱…</p><p v-else-if="!conversations.length" class="quiet-state">还没有会话。<br>搜搜你想认识的人吧。</p>
          <ul class="conversation-list"><li v-for="item in conversations" :key="item.id"><button :class="{ selected: active?.id === item.id }" :disabled="sending" @click="select(item)"><span class="avatar">{{ Array.from(item.otherUser.nickname)[0] }}</span><span class="conversation-preview"><strong>{{ item.otherUser.nickname }}</strong><small>{{ item.lastMessage?.body || '打个招呼吧' }}</small></span></button></li></ul>
          <button v-if="moreConversations" class="load-more" :disabled="loading" @click="loadConversations">更多会话</button>
        </aside>
        <section v-if="active" class="chat-pane" :aria-label="`与 ${active.otherUser.nickname} 的私聊`">
          <header class="chat-header"><button class="chat-back" aria-label="返回会话列表" @click="hasSelected = false">‹</button><span class="avatar">{{ Array.from(active.otherUser.nickname)[0] }}</span><div><h2>{{ active.otherUser.nickname }}</h2><p>一对一私聊</p></div></header>
          <div ref="history" class="chat-history"><button v-if="moreMessages" class="load-more" :disabled="loadingMessages" @click="loadMessages">{{ loadingMessages ? '正在加载…' : '更早的消息' }}</button><p v-if="loadingMessages && !messages.length" class="quiet-state">正在加载消息…</p><p v-else-if="!messages.length" class="quiet-state">从一句 Ciallo～ 开始吧。</p><ol class="private-messages"><li v-for="message in messages" :key="message.id" :class="{ mine: message.sender.id === user.id }"><span class="private-author">{{ message.sender.nickname }}</span><p>{{ message.body }}</p><time :datetime="message.createdAt">{{ displayTime(message.createdAt) }}</time></li></ol></div>
          <form class="chat-compose" @submit.prevent="send"><label class="sr-only" for="private-draft">私信内容</label><textarea id="private-draft" v-model="draft" :disabled="sending" rows="2" maxlength="1000" placeholder="只说给对方听…" aria-describedby="private-count"></textarea><div><span id="private-count" :class="{ 'over-limit': length > 500 }">{{ length }} / 500</span><span v-if="notice" class="sent-note" role="status">{{ notice }}</span><button class="small-button" :disabled="sending || !length || length > 500">{{ sending ? '正在发送…' : '发送私信' }}</button></div><p class="private-draft-note">切换会话或离开私聊会清空未发送内容。</p></form>
        </section>
        <div v-else class="chat-placeholder"><span class="letter-icon" aria-hidden="true">✉</span><h2>让喜欢，有人回应。</h2><p>选择一个会话，或搜索昵称开始聊天。<br>私信仅向会话双方展示。</p></div>
      </div>
    </template>
  </section>
</template>
