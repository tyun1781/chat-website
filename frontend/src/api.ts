import { ref } from 'vue'
export interface User { id: string; username: string; nickname: string; role: 'user' | 'admin'; status: 'active' | 'disabled'; createdAt: string; updatedAt: string }
interface Session { user: User; csrfToken: string; expiresAt: string }
export class ApiError extends Error {
  constructor(public code: string, message: string, public fields: Record<string, string> = {}) { super(message) }
}
export const user = ref<User | null>(null)
export const sessionNotice = ref('')
let csrfToken = ''
let restoration: Promise<void> | null = null
export function clearSession() { user.value = null; csrfToken = '' }
export function acceptSession(data: Session) { user.value = data.user; csrfToken = data.csrfToken; sessionNotice.value = '' }
export async function restoreSession() {
  if (!restoration) restoration = (async () => {
    const data = await request<Session>('/auth/session')
    acceptSession(data)
  })().finally(() => { restoration = null })
  return restoration
}
export async function request<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  let response: Response
  try { response = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) }) }
  catch { throw new ApiError('NETWORK_ERROR', '暂时无法连接服务，请检查网络后重试。') }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = payload?.error
    if (error?.code === 'CSRF_INVALID' && retry && !path.startsWith('/auth/')) {
      await restoreSession()
      return request<T>(path, method, body, false)
    }
    if (error?.code === 'CSRF_INVALID' && retry && path === '/auth/logout') {
      try { await restoreSession() } catch (e) { if (!(e instanceof ApiError && e.code === 'UNAUTHENTICATED')) throw e }
      return request<T>(path, method, body, false)
    }
    if (error?.code === 'UNAUTHENTICATED' || error?.code === 'ACCOUNT_DISABLED') {
      const wasLoggedIn = !!user.value
      clearSession()
      if (wasLoggedIn) sessionNotice.value = error.code === 'ACCOUNT_DISABLED' ? '此账号已被停用。' : '登录已过期，请重新登录。未提交的内容已保留。'
    }
    throw new ApiError(error?.code || 'SERVICE_ERROR', error?.message || '服务暂时不可用，请稍后重试。', error?.fields)
  }
  if (!payload || !('data' in payload)) throw new ApiError('INVALID_RESPONSE', '服务响应异常，请稍后重试。')
  return payload.data as T
}
export async function login(username: string, password: string) { acceptSession(await request<Session>('/auth/login', 'POST', { username, password })) }
