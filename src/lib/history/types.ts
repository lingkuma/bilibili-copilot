import type { ShareImageSnapshot } from '../share/telegraph'
import type { ResolvedVideo, SubtitleForAI } from '../types'

export type HistoryEntryKind = 'summary' | 'chat'
export type HistoryChatRole = 'user' | 'assistant'

export type HistoryEntry = {
  id: string
  kind: HistoryEntryKind
  createdAt: number
  content: string
  images?: ShareImageSnapshot
  role?: HistoryChatRole
  templateId?: string
}

export type HistoryThread = {
  id: string
  video: ResolvedVideo
  subtitle?: SubtitleForAI
  entries: HistoryEntry[]
  createdAt: number
  updatedAt: number
}

export type HistoryThreadSummary = {
  id: string
  video: ResolvedVideo
  entryCount: number
  createdAt: number
  updatedAt: number
}

