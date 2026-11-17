<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ApiError, request, user } from '../api'
import { displayTime, failureMessage, normalizeBody, type Comment, type Page, type Person } from '../forumTypes'
const props = defineProps<{ postId: string; events: EventTarget }>()
const emit = defineEmits<{ login: []; chat: [person: Person] }>()
const comments = ref<Comment[]>([]), loading = ref(false), sending = ref(false), error = ref(''), draft = ref(''), notice = ref('')
const hasMore = ref(false), confirming = ref<string | null>(null), deleting = ref(false)
const length = computed(() => Array.from(normalizeBody(draft.value)).length)
const removed = new Set<string>(), controller = new AbortController()
let cursor: string | null = null, disposed = false, pending: { body: string; userId: string; key: string } | null = null
function merge(items: Comment[]) {
  const map = new Map(comments.value.map(item => [item.id, item]))
  for (const item of items) if (!removed.has(item.id)) map.set(item.id, item)
  comments.value = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}
function remove(id: string) { removed.add(id); comments.value = comments.value.filter(item => item.id !== id) }
async function load() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const page = await request<Page<Comment>>(`/messages/${props.postId}/comments?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, true, { envelope: true, signal: controller.signal })
    if (disposed) return
    merge(page.data); cursor = page.page.nextCursor; hasMore.value = page.page.hasMore
  } catch (e) { if (!disposed) error.value = failureMessage(e) }
  finally { if (!disposed) loading.value = false }
}
async function send() {
  if (!user.value) { emit('login'); return }
  if (sending.value || length.value < 1 || length.value > 500) return
  const body = normalizeBody(draft.value), owner = user.value.id
  if (!pending || pending.body !== body || pending.userId !== owner) pending = { body, userId: owner, key: crypto.randomUUID() }
  sending.value = true; error.value = ''; notice.value = ''
  try {
    const data = await request<{ comment: Comment }>(`/messages/${props.postId}/comments`, 'POST', { body }, true, { headers: { 'Idempotency-Key': pending.key }, signal: controller.signal })
    if (disposed) return
    merge([data.comment]); draft.value = ''; pending = null; notice.value = '评论已发布。'
  } catch (e) { if (!disposed) { error.value = failureMessage(e); if (e instanceof ApiError && e.code === 'IDEMPOTENCY_CONFLICT') pending = null } }
  finally { if (!disposed) sending.value = false }
}
async function deleteComment(id: string) {
  deleting.value = true; error.value = ''
  try { await request(`/comments/${id}`, 'DELETE', undefined, true, { signal: controller.signal }); if (!disposed) { remove(id); notice.value = '评论已删除。' } }
  catch (e) { if (!disposed) error.value = failureMessage(e) }
  finally { deleting.value = false; confirming.value = null }
}
function receive(event: Event) {
  const { type, data } = (event as CustomEvent<{ type: string; data: { comment?: Comment; messageId?: string; commentId?: string } }>).detail
  if (type === 'comment.created' && data.comment?.messageId === props.postId) merge([data.comment])
  if (type === 'comment.deleted' && data.messageId === props.postId && data.commentId) remove(data.commentId)
}
onMounted(() => { props.events.addEventListener('comment', receive); void load() })
onUnmounted(() => { disposed = true; controller.abort(); props.events.removeEventListener('comment', receive) })
</script>
<template>
  <section class="comments-panel" :aria-label="'帖子评论'">
    <div class="comments-heading"><h4>一起聊聊</h4><span>最新回复在前</span></div>
    <p v-if="error" class="message-error" role="alert">{{ error }} <button type="button" class="text-link" :disabled="loading" @click="load">重新加载</button></p>
    <p v-if="notice" class="action-notice" role="status">{{ notice }}</p>
    <form class="comment-compose" @submit.prevent="send">
      <label class="sr-only" :for="`reply-${postId}`">评论内容</label><textarea :id="`reply-${postId}`" v-model="draft" :disabled="sending" maxlength="1000" rows="2" placeholder="接住这个话题…" :aria-describedby="`reply-count-${postId}`"></textarea>
      <div class="comment-compose-bottom"><span :id="`reply-count-${postId}`" :class="{ 'over-limit': length > 500 }">{{ length }} / 500</span><button class="small-button" :disabled="sending || (!!user && (!length || length > 500))">{{ sending ? '正在发布…' : user ? '发布评论' : '登录后评论' }}</button></div>
    </form>
    <p v-if="loading && !comments.length" class="quiet-state" role="status">正在加载评论…</p><p v-else-if="!comments.length && !error" class="quiet-state">还没有回复，来打个招呼吧。</p>
    <ol class="comment-list"><li v-for="comment in comments" :key="comment.id"><div class="comment-meta"><button class="author-link" :disabled="comment.author.id === user?.id" @click="emit('chat', comment.author)">{{ comment.author.nickname }}</button><time :datetime="comment.createdAt">{{ displayTime(comment.createdAt) }}</time></div><p>{{ comment.body }}</p><div v-if="user?.id === comment.author.id" class="message-actions"><template v-if="confirming === comment.id"><span>删除评论？</span><button class="delete-confirm" :disabled="deleting" @click="deleteComment(comment.id)">确认删除</button><button :disabled="deleting" @click="confirming = null">取消</button></template><button v-else @click="confirming = comment.id">删除</button></div></li></ol>
    <button v-if="hasMore" class="load-more" :disabled="loading" @click="load">{{ loading ? '正在加载…' : '更早的评论' }}</button>
  </section>
</template>
