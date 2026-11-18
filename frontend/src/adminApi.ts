import { request, type User } from './api'
import type { Message } from './useMessages'

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'
export interface AdminApplication {
  id: string
  user: User
  statement: string
  status: ApplicationStatus
  reviewedBy: { id: string; nickname: string } | null
  reviewedAt: string | null
  reviewReason: string | null
  createdAt: string
  updatedAt: string
}
export interface AdminPage<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean } }

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function getMyApplication() {
  return request<{ application: AdminApplication | null }>('/admin-applications/me')
}
export function applyForAdmin(statement: string) {
  return request<{ application: AdminApplication }>('/admin-applications', 'POST', { statement })
}
export function getAdminApplications(status?: ApplicationStatus) {
  return request<AdminPage<AdminApplication>>(`/admin/applications${query({ status, limit: '100' })}`, 'GET', undefined, true, { envelope: true })
}
export function reviewAdminApplication(id: string, decision: 'approve' | 'reject', reason?: string) {
  return request<{ application: AdminApplication }>(`/admin/applications/${encodeURIComponent(id)}`, 'PATCH', { decision, reason: reason || undefined })
}
export function getAdminUsers(params: { q?: string; status?: 'active' | 'disabled' } = {}) {
  return request<AdminPage<User>>(`/admin/users${query({ ...params, limit: '100' })}`, 'GET', undefined, true, { envelope: true })
}
export function setUserStatus(id: string, status: 'active' | 'disabled', reason: string) {
  return request<{ user: User }>(`/admin/users/${encodeURIComponent(id)}/status`, 'PATCH', { status, reason })
}
export function deleteAdminMessage(id: string, reason: string) {
  return request(`/admin/messages/${encodeURIComponent(id)}`, 'DELETE', { reason })
}
export function getRecentMessages() {
  return request<Message[]>('/messages?limit=50')
}
