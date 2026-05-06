import type { ShareImageSnapshot } from './share/telegraph'
import type { HistoryEntry, HistoryThread } from './history/types'
import type { DetectedVideo, ResolvedVideo } from './types'

export type RuntimeMessage =
  | {
    type: 'VIDEO_DETECTED'
    video: DetectedVideo
  }
  | {
    type: 'GET_CURRENT_VIDEO'
  }
  | {
    type: 'OPEN_FLOATING_PANEL'
  }
  | {
    type: 'OPEN_FLOATING_SETTINGS'
  }
  | {
    type: 'GET_SUBTITLE_FOR_VIDEO'
    video: DetectedVideo
    force?: boolean
  }
  | {
    type: 'SUMMARIZE_VIDEO'
    video: DetectedVideo
    templateId?: string
  }
  | {
    type: 'SUMMARIZE_CURRENT_VIDEO'
    templateId?: string
  }
  | {
    type: 'GET_SUBTITLE_CURRENT_VIDEO'
  }
  | {
    type: 'SHARE_SUMMARY_TO_TELEGRAPH'
    video: ResolvedVideo
    summary: string
    images: ShareImageSnapshot
  }
  | {
    type: 'SHARE_HISTORY_THREAD_TO_TELEGRAPH'
    thread: HistoryThread
  }
  | {
    type: 'SHARE_HISTORY_THREAD_TO_TELEGRAM'
    thread: HistoryThread
  }
  | {
    type: 'ANSWER_SUBTITLE_QUESTION'
    video: ResolvedVideo
    question: string
    entries: HistoryEntry[]
  }
  | {
    type: 'SAVE_HISTORY_THREAD'
    thread: HistoryThread
  }
  | {
    type: 'GET_HISTORY_THREADS'
  }
  | {
    type: 'GET_HISTORY_THREAD'
    id: string
  }
  | {
    type: 'DELETE_HISTORY_THREAD'
    id: string
  }

export interface RuntimeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export type StreamPortRequest = {
  type: 'STREAM_SUMMARIZE_VIDEO'
  video: DetectedVideo
  templateId?: string
}

export type StreamPortEvent =
  | {
    type: 'SUMMARY_STREAM_START'
    data: unknown
  }
  | {
    type: 'SUMMARY_STREAM_DELTA'
    content: string
  }
  | {
    type: 'SUMMARY_STREAM_DONE'
    summary: string
  }
  | {
    type: 'SUMMARY_STREAM_ERROR'
    error: string
  }

export const ok = <T>(data: T): RuntimeResponse<T> => ({
  ok: true,
  data,
})

export const fail = (error: unknown): RuntimeResponse => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})
