export interface Person { id: string; nickname: string }
export interface Comment { id: string; messageId: string; author: Person; body: string; createdAt: string }
export interface DirectMessage { id: string; conversationId: string; sender: Person; body: string; createdAt: string }
export interface Conversation { id: string; otherUser: Person; createdAt: string; updatedAt: string; lastMessage: DirectMessage | null }
export interface Page<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean }; sync?: { eventCursor: string } }
export const normalizeBody = (body: string) => body.replace(/\r\n?/g, '\n').trim()
export const displayTime = (time: string) => new Date(time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const failureMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'
