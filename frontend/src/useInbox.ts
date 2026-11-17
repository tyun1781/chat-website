import { computed, onUnmounted, ref, watch } from 'vue'
import { ApiError, clearSession, request, sessionNotice, user } from './api'
import { failureMessage, normalizeBody, type Conversation, type DirectMessage, type Page, type Person } from './forumTypes'
interface PrivateEvent { id: string; type: 'conversation.created' | 'dm.message.created'; data: { conversationId: string; message?: DirectMessage } }
export function useInbox() {
  const conversations = ref<Conversation[]>([]), active = ref<Conversation | null>(null), messages = ref<DirectMessage[]>([])
  const results = ref<Person[]>([]), query = ref(''), draft = ref(''), error = ref(''), searchError = ref(''), notice = ref('')
  const loading = ref(false), searching = ref(false), opening = ref(false), loadingMessages = ref(false), sending = ref(false)
  const moreConversations = ref(false), moreMessages = ref(false), status = ref('正在连接')
  const length = computed(() => Array.from(normalizeBody(draft.value)).length)
  let owner = '', generation = 0, selection = 0, disposed = false, eventCursor = '0', conversationCursor: string | null = null, messageCursor: string | null = null
  let controller = new AbortController(), source: EventSource | null = null, timer: ReturnType<typeof setTimeout> | null = null, recovering = false
  let pending: { conversationId: string; body: string; key: string } | null = null
  let initialized = false
  const valid = (epoch: number) => !disposed && epoch === generation && user.value?.id === owner
  function stop() { source?.close(); source = null; if (timer) clearTimeout(timer); timer = null }
  function reset() {
    generation++; selection++; stop(); controller.abort(); controller = new AbortController()
    conversations.value = []; active.value = null; messages.value = []; results.value = []; query.value = ''; draft.value = ''; error.value = ''; searchError.value = ''; notice.value = ''
    pending = null; initialized = false; eventCursor = '0'; conversationCursor = null; messageCursor = null
    loading.value = false; searching.value = false; opening.value = false; sending.value = false; loadingMessages.value = false
    moreConversations.value = false; moreMessages.value = false; status.value = '正在连接'
  }
  function mergeConversations(items: Conversation[]) {
    const map = new Map(conversations.value.map(item => [item.id, item]))
    for (const item of items) {
      const old = map.get(item.id)
      if (!old || old.updatedAt <= item.updatedAt) map.set(item.id, item)
    }
    conversations.value = [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  }
  function mergeMessages(items: DirectMessage[]) {
    const map = new Map(messages.value.map(item => [item.id, item]))
    for (const item of items) if (item.conversationId === active.value?.id) map.set(item.id, item)
    messages.value = [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }
  async function refreshConversations(epoch = generation) {
    const page = await request<Page<Conversation>>('/dm/conversations?limit=20', 'GET', undefined, true, { envelope: true, signal: controller.signal })
    if (valid(epoch)) mergeConversations(page.data)
    return page
  }
  async function loadConversations() {
    if (loading.value || !conversationCursor) return
    const epoch = generation; loading.value = true; error.value = ''
    try {
      const page = await request<Page<Conversation>>(`/dm/conversations?limit=20&cursor=${encodeURIComponent(conversationCursor)}`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
      if (!valid(epoch)) return
      mergeConversations(page.data); conversationCursor = page.page.nextCursor; moreConversations.value = page.page.hasMore
    } catch (e) { if (valid(epoch)) error.value = failureMessage(e) }
    finally { if (valid(epoch)) loading.value = false }
  }
  async function apply(event: PrivateEvent, epoch: number) {
    if (!valid(epoch) || !/^\d+$/.test(event.id) || BigInt(event.id) <= BigInt(eventCursor)) return
    if (event.type === 'dm.message.created' && event.data.message) {
      mergeMessages([event.data.message])
      const conversation = conversations.value.find(item => item.id === event.data.conversationId)
      if (conversation) mergeConversations([{ ...conversation, lastMessage: event.data.message, updatedAt: event.data.message.createdAt }])
      else await refreshConversations(epoch)
    } else if (event.type === 'conversation.created') await refreshConversations(epoch)
    if (valid(epoch) && BigInt(event.id) > BigInt(eventCursor)) eventCursor = event.id
  }
  function schedule() { stop(); status.value = navigator.onLine ? '正在重新连接' : '离线，等待网络'; if (!disposed && user.value) timer = setTimeout(() => { void recover() }, 3000) }
  function connect(epoch: number) {
    if (!valid(epoch)) return
    stop(); const stream = new EventSource(`/api/dm/stream?after=${encodeURIComponent(eventCursor)}`); source = stream
    let sequence = Promise.resolve()
    stream.onopen = () => { if (source === stream && valid(epoch)) status.value = '私聊已连接' }
    for (const type of ['conversation.created', 'dm.message.created'] as const) stream.addEventListener(type, (event: MessageEvent) => {
      if (source !== stream || !valid(epoch)) return
      sequence = sequence.then(async () => { if (source === stream && valid(epoch)) await apply({ id: event.lastEventId, type, data: JSON.parse(event.data) }, epoch) }).catch(() => { if (valid(epoch)) schedule() })
    })
    stream.addEventListener('auth.expired', () => { if (source === stream && valid(epoch)) { clearSession(); sessionNotice.value = '登录已过期，私聊内容已清空，请重新登录。' } })
    stream.addEventListener('sync.reset', () => { if (source === stream && valid(epoch)) void start() })
    stream.onerror = () => { if (source === stream && valid(epoch)) schedule() }
  }
  async function recover() {
    if (!owner || !user.value || disposed || recovering) return
    if (!initialized) { await start(); return }
    const epoch = generation; recovering = true
    try {
      let more = true, after = eventCursor
      while (more && valid(epoch)) {
        const page = await request<Page<PrivateEvent>>(`/dm/events?after=${encodeURIComponent(after)}&limit=100`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
        if (!valid(epoch)) return
        for (const event of page.data) await apply(event, epoch)
        if (page.page.hasMore && (!page.page.nextCursor || page.page.nextCursor === after)) throw new Error('私聊同步暂时中断')
        after = page.page.nextCursor || after; more = page.page.hasMore
      }
      if (valid(epoch)) { await refreshConversations(epoch); error.value = ''; connect(epoch) }
    } catch (e) {
      if (!valid(epoch)) return
      if (e instanceof ApiError && ['INVALID_CURSOR', 'EVENT_CURSOR_EXPIRED'].includes(e.code)) { void start(); return }
      error.value = failureMessage(e); schedule()
    } finally { recovering = false }
  }
  async function start() {
    reset(); owner = user.value?.id || ''
    if (!owner) return
    const epoch = generation; loading.value = true
    try {
      const page = await refreshConversations(epoch)
      if (!valid(epoch)) return
      conversationCursor = page.page.nextCursor; moreConversations.value = page.page.hasMore; eventCursor = page.sync?.eventCursor || '0'; initialized = true; connect(epoch)
    } catch (e) { if (valid(epoch)) { error.value = failureMessage(e); schedule() } }
    finally { if (valid(epoch)) loading.value = false }
  }
  async function search() {
    const q = query.value.trim(), epoch = generation
    if (!q || Array.from(q).length > 32 || searching.value || !owner) return
    searching.value = true; searchError.value = ''; results.value = []
    try { const data = await request<Person[]>(`/users/search?q=${encodeURIComponent(q)}`, 'GET', undefined, true, { signal: controller.signal }); if (valid(epoch)) { results.value = data; if (!data.length) searchError.value = '没有找到这个昵称，试试其他名字。' } }
    catch (e) { if (valid(epoch)) searchError.value = failureMessage(e) }
    finally { if (valid(epoch)) searching.value = false }
  }
  async function select(conversation: Conversation) {
    if (sending.value) return
    active.value = conversation; messages.value = []; draft.value = ''; pending = null; messageCursor = null; moreMessages.value = false; notice.value = ''; error.value = ''
    selection++; loadingMessages.value = false; await loadMessages()
  }
  async function loadMessages() {
    if (!active.value || loadingMessages.value) return
    const id = active.value.id, epoch = generation, selected = selection
    loadingMessages.value = true
    try {
      const page = await request<Page<DirectMessage>>(`/dm/conversations/${id}/messages?limit=30${messageCursor ? `&cursor=${encodeURIComponent(messageCursor)}` : ''}`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
      if (!valid(epoch) || selected !== selection) return
      mergeMessages(page.data); messageCursor = page.page.nextCursor; moreMessages.value = page.page.hasMore
    } catch (e) { if (valid(epoch) && selected === selection) error.value = failureMessage(e) }
    finally { if (valid(epoch) && selected === selection) loadingMessages.value = false }
  }
  async function openConversation(person: Person) {
    if (!owner || opening.value || sending.value) return
    const epoch = generation; opening.value = true; error.value = ''
    try {
      const data = await request<{ conversation: Conversation }>('/dm/conversations', 'POST', { userId: person.id }, true, { signal: controller.signal })
      if (!valid(epoch)) return
      mergeConversations([data.conversation]); results.value = []; query.value = ''; await select(data.conversation)
    } catch (e) { if (valid(epoch)) error.value = failureMessage(e) }
    finally { if (valid(epoch)) opening.value = false }
  }
  async function send() {
    if (!active.value || !owner || sending.value || !length.value || length.value > 500) return
    const id = active.value.id, body = normalizeBody(draft.value), epoch = generation
    if (!pending || pending.body !== body || pending.conversationId !== id) pending = { body, conversationId: id, key: crypto.randomUUID() }
    sending.value = true; error.value = ''; notice.value = ''
    try {
      const data = await request<{ message: DirectMessage }>(`/dm/conversations/${id}/messages`, 'POST', { body }, true, { headers: { 'Idempotency-Key': pending.key }, signal: controller.signal })
      if (!valid(epoch)) return
      mergeMessages([data.message]); mergeConversations([{ ...active.value!, lastMessage: data.message, updatedAt: data.message.createdAt }]); draft.value = ''; pending = null; notice.value = '私信已发送。'
    } catch (e) { if (valid(epoch)) { error.value = failureMessage(e); if (e instanceof ApiError && e.code === 'IDEMPOTENCY_CONFLICT') pending = null } }
    finally { if (valid(epoch)) sending.value = false }
  }
  watch(() => user.value?.id, () => { void start() }, { immediate: true, flush: 'sync' })
  onUnmounted(() => { disposed = true; reset() })
  return { conversations, active, messages, results, query, draft, error, searchError, notice, loading, searching, opening, loadingMessages, sending, moreConversations, moreMessages, status, length, search, select, openConversation, send, loadMessages, loadConversations, start }
}
