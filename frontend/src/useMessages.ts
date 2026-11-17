import { computed, markRaw, onMounted, onUnmounted, ref } from 'vue'
import type { Comment } from './forumTypes'
import { ApiError, request, user } from './api'

export interface Message { id: string; author: { id: string; nickname: string }; body: string; tag: string; createdAt: string }
export interface ForumTag { id: string; label: string }
interface BoardEvent { id: string; type: 'message.created' | 'message.deleted' | 'comment.created' | 'comment.deleted'; data: { message?: Message; messageId?: string; comment?: Comment; commentId?: string } }
interface MessagePage { data: Message[]; page: { nextCursor: string | null; hasMore: boolean }; sync: { eventCursor: string } }
interface EventPage { data: BoardEvent[]; page: { nextCursor: string; hasMore: boolean } }
const errorText = (error: unknown) => error instanceof Error ? error.message : '暂时无法加载，请重试。'
const newer = (a: string, b: string) => BigInt(a) > BigInt(b)
const normalize = (body: string) => body.replace(/\r\n?/g, '\n').trim()

export function useMessages() {
  const forumEvents = markRaw(new EventTarget())
  const messages = ref<Message[]>([]), draft = ref(''), loading = ref(true), loadingMore = ref(false)
  const loadError = ref(''), publishError = ref(''), actionNotice = ref(''), deleteError = ref('')
  const publishing = ref(false), deleting = ref<string | null>(null), hasMore = ref(false)
  const tags = ref<ForumTag[]>([]), tagsLoading = ref(false), tagsError = ref('')
  const selectedTag = ref(''), composeTag = ref('daily')
  const status = ref<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting')
  const statusText = computed(() => ({ connecting: '正在连接', live: '实时更新中', reconnecting: '正在重新连接', offline: '离线，等待网络' })[status.value])
  const draftLength = computed(() => Array.from(normalize(draft.value)).length)
  let cursor: string | null = null, eventCursor = '0', generation = 0, disposed = false
  let source: EventSource | null = null, timer: ReturnType<typeof setTimeout> | null = null
  let controller = new AbortController(), buffered: BoardEvent[] = [], recovering = false
  const deleted = new Set<string>()
  const catalogController = new AbortController()
  let pendingSubmission: { userId: string; body: string; tag: string; key: string } | null = null
  const tagLabel = (id: string) => tags.value.find(tag => tag.id === id)?.label || id
  const filterQuery = () => selectedTag.value ? `&tag=${encodeURIComponent(selectedTag.value)}` : ''
  const matchesFilter = (row: Message) => !selectedTag.value || (row.tag || 'daily') === selectedTag.value
  async function loadTags() {
    if (tagsLoading.value) return
    tagsLoading.value = true; tagsError.value = ''
    try {
      const data = await request<ForumTag[]>('/tags', 'GET', undefined, true, { signal: catalogController.signal })
      if (disposed) return
      tags.value = data
      if (!tags.value.some(tag => tag.id === composeTag.value)) composeTag.value = tags.value[0]?.id || ''
    } catch (error) { if (!disposed) tagsError.value = errorText(error) }
    finally { if (!disposed) tagsLoading.value = false }
  }
  async function selectTag(tag: string) {
    if (tag === selectedTag.value || tag && !tags.value.some(item => item.id === tag)) return
    selectedTag.value = tag; actionNotice.value = ''; deleteError.value = ''
    if (!draft.value.trim() && !publishing.value) composeTag.value = tag || (tags.value.some(item => item.id === 'daily') ? 'daily' : tags.value[0]?.id || '')
    await reload()
  }
  function merge(rows: Message[]) {
    const byId = new Map(messages.value.map(message => [message.id, message]))
    for (const row of rows) if (!deleted.has(row.id) && matchesFilter(row)) byId.set(row.id, row)
    messages.value = [...byId.values()].filter(matchesFilter).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }
  function remove(id: string) { deleted.add(id); messages.value = messages.value.filter(message => message.id !== id) }
  function apply(event: BoardEvent) {
    if (!/^\d+$/.test(event.id) || !newer(event.id, eventCursor)) return
    if (event.type === 'message.created' && event.data.message) merge([event.data.message])
    else if (event.type === 'message.deleted' && event.data.messageId) remove(event.data.messageId)
    else if (event.type === 'comment.created' || event.type === 'comment.deleted') forumEvents.dispatchEvent(new CustomEvent('comment', { detail: event }))
    else throw new Error('留言同步数据异常，正在重新连接。')
    eventCursor = event.id
  }
  function receive(event: BoardEvent) {
    if (!/^\d+$/.test(event.id)) throw new Error('留言同步数据异常')
    if (loadingMore.value) buffered.push(event); else apply(event)
  }
  function flush() {
    const events = buffered; buffered = []
    events.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
    for (const event of events) apply(event)
  }
  function stopStream() { source?.close(); source = null; if (timer) clearTimeout(timer); timer = null }
  function scheduleRecovery() {
    stopStream()
    status.value = navigator.onLine ? 'reconnecting' : 'offline'
    if (!disposed) timer = setTimeout(() => { void recover() }, 3000)
  }
  function connect(epoch: number) {
    if (disposed || epoch !== generation) return
    stopStream()
    const stream = new EventSource(`/api/events?after=${encodeURIComponent(eventCursor)}`)
    source = stream
    stream.onopen = () => { if (source === stream) status.value = 'live' }
    for (const type of ['message.created', 'message.deleted', 'comment.created', 'comment.deleted'] as const) {
      stream.addEventListener(type, (event: MessageEvent) => {
        if (source !== stream || epoch !== generation) return
        try { receive({ id: event.lastEventId, type, data: JSON.parse(event.data) }) }
        catch { scheduleRecovery() }
      })
    }
    stream.addEventListener('sync.reset', () => { if (source === stream) void reload() })
    stream.onerror = () => { if (source === stream) scheduleRecovery() }
  }
  async function recover() {
    if (disposed || recovering) return
    if (loading.value || loadError.value && !messages.value.length) { await reload(); return }
    recovering = true
    const epoch = generation
    let after = eventCursor
    try {
      let more = true
      while (more && epoch === generation && !disposed) {
        const page = await request<EventPage>(`/messages/events?after=${encodeURIComponent(after)}&limit=100`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
        if (epoch !== generation || disposed) return
        for (const event of page.data) receive(event)
        if (page.page.hasMore && page.page.nextCursor === after) throw new Error('同步游标没有前进')
        after = page.page.nextCursor; more = page.page.hasMore
      }
      connect(epoch)
    } catch (error) {
      if (epoch !== generation || disposed) return
      if (error instanceof ApiError && ['EVENT_CURSOR_EXPIRED', 'INVALID_CURSOR'].includes(error.code)) { void reload(); return }
      scheduleRecovery()
    } finally { recovering = false }
  }
  async function reload() {
    const epoch = ++generation
    stopStream(); controller.abort(); controller = new AbortController()
    buffered = []; deleted.clear(); messages.value = []; loadingMore.value = false; cursor = null; eventCursor = '0'; hasMore.value = false
    loading.value = true; loadError.value = ''; status.value = 'connecting'
    try {
      const page = await request<MessagePage>(`/messages?limit=20${filterQuery()}`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
      if (epoch !== generation || disposed) return
      merge(page.data); cursor = page.page.nextCursor; hasMore.value = page.page.hasMore; eventCursor = page.sync.eventCursor
      connect(epoch)
    } catch (error) {
      if (epoch !== generation || disposed) return
      loadError.value = errorText(error); status.value = navigator.onLine ? 'reconnecting' : 'offline'
      scheduleRecovery()
    } finally { if (epoch === generation) loading.value = false }
  }
  async function loadMore() {
    if (loadingMore.value || loading.value || !hasMore.value || !cursor) return
    loadingMore.value = true; loadError.value = ''
    const epoch = generation
    try {
      const page = await request<MessagePage>(`/messages?limit=20&cursor=${encodeURIComponent(cursor)}${filterQuery()}`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
      if (epoch !== generation || disposed) return
      merge(page.data); cursor = page.page.nextCursor; hasMore.value = page.page.hasMore
      // A historical page's snapshot must never replace the event stream cursor.
    } catch (error) { if (epoch === generation) loadError.value = errorText(error) }
    finally { if (epoch === generation) { loadingMore.value = false; flush() } }
  }
  async function publish() {
    if (publishing.value || !user.value) return
    const body = normalize(draft.value)
    if (Array.from(body).length < 1 || Array.from(body).length > 500) { publishError.value = '请输入 1～500 字的帖子内容。'; return }
    const userId = user.value.id, tag = composeTag.value
    if (!tags.value.some(item => item.id === tag)) { publishError.value = '请选择一个可用的帖子标签。'; return }
    if (!pendingSubmission || pendingSubmission.body !== body || pendingSubmission.userId !== userId || pendingSubmission.tag !== tag) pendingSubmission = { userId, body, tag, key: crypto.randomUUID() }
    const submission = pendingSubmission
    publishing.value = true; publishError.value = ''; actionNotice.value = ''
    try {
      const result = await request<{ message: Message }>('/messages', 'POST', { body, tag }, true, { headers: { 'Idempotency-Key': submission.key } })
      if (disposed) return
      merge([result.message])
      if (normalize(draft.value) === body) draft.value = ''
      pendingSubmission = null; actionNotice.value = matchesFilter(result.message) ? '帖子已发布。' : `帖子已发布到“${tagLabel(tag)}”，当前筛选不显示这条帖子。`
    } catch (error) {
      publishError.value = errorText(error)
      if (error instanceof ApiError && error.code === 'IDEMPOTENCY_CONFLICT') pendingSubmission = null
    } finally { publishing.value = false }
  }
  async function deleteMessage(id: string) {
    if (deleting.value) return
    deleting.value = id; deleteError.value = ''; actionNotice.value = ''
    try { await request(`/messages/${encodeURIComponent(id)}`, 'DELETE'); remove(id); actionNotice.value = '帖子已删除。' }
    catch (error) { deleteError.value = errorText(error) }
    finally { deleting.value = null }
  }
  function online() { if (!disposed) { stopStream(); void recover() } }
  function offline() { stopStream(); status.value = 'offline' }
  onMounted(() => { void loadTags(); void reload(); window.addEventListener('online', online); window.addEventListener('offline', offline) })
  onUnmounted(() => { disposed = true; generation++; stopStream(); controller.abort(); catalogController.abort(); window.removeEventListener('online', online); window.removeEventListener('offline', offline) })
  return { forumEvents, messages, draft, draftLength, loading, loadingMore, loadError, publishError, deleteError, actionNotice, publishing, deleting, hasMore, status, statusText, reload, loadMore, publish, deleteMessage, tags, tagsLoading, tagsError, selectedTag, composeTag, selectTag, loadTags, tagLabel }
}
