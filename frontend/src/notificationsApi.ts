import { ref } from 'vue'
import { request, user } from './api'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  data: { messageId?: string; reason?: string; excerpt?: string } & Record<string, unknown>
  readAt: string | null
  createdAt: string
}
export interface NotificationsPage {
  data: AppNotification[]
  page: { nextCursor: string | null; hasMore: boolean }
  unreadCount: number
}
export const unreadNotifications = ref(0)

export function clearNotifications() { unreadNotifications.value = 0 }
export function getNotifications(limit = 20, cursor?: string) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  return request<NotificationsPage>(`/notifications?${query.toString()}`, 'GET', undefined, true, { envelope: true })
}
export async function refreshUnread() {
  if (!user.value) { clearNotifications(); return }
  try { unreadNotifications.value = (await getNotifications(1)).unreadCount }
  catch { /* Keep the last known count; the notification page shows the error. */ }
}
export async function markNotificationRead(id: string) {
  await request(`/notifications/${encodeURIComponent(id)}/read`, 'PATCH')
  unreadNotifications.value = Math.max(0, unreadNotifications.value - 1)
}
export async function markAllNotificationsRead() {
  const data = await request<{ updated: number }>('/notifications/read-all', 'POST')
  unreadNotifications.value = 0
  return data.updated
}
