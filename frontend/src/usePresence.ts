import { computed, onMounted, onUnmounted, ref } from 'vue'
import { request } from './api'
export function usePresence() {
  const count = ref<number | null>(null), unavailable = ref(false)
  const label = computed(() => unavailable.value ? '在线人数暂不可用' : count.value === null ? '正在连接…' : `在线 ${count.value} 人`)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null, disposed = false, fetching = false
  async function refresh() {
    if (disposed || fetching) return
    fetching = true
    try {
      const data = await request<{ onlineCount: number }>('/presence', 'GET', undefined, true, { signal: controller.signal })
      if (!disposed) {
        if (!Number.isInteger(data.onlineCount) || data.onlineCount < 0) throw new Error('Invalid presence count')
        count.value = data.onlineCount; unavailable.value = false
      }
    } catch { if (!disposed) { count.value = null; unavailable.value = true } }
    finally { fetching = false; if (!disposed) timer = setTimeout(() => { void refresh() }, 15000) }
  }
  function resume() { if (!document.hidden && !fetching) { if (timer) clearTimeout(timer); void refresh() } }
  onMounted(() => { timer = setTimeout(() => { void refresh() }, 900); document.addEventListener('visibilitychange', resume) })
  onUnmounted(() => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', resume) })
  return { label, unavailable }
}
