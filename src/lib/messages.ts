import type { DetectedVideo } from './types'

export type RuntimeMessage =
  | {
    type: 'VIDEO_DETECTED'
    video: DetectedVideo
  }
  | {
    type: 'GET_CURRENT_VIDEO'
  }
  | {
    type: 'OPEN_SIDE_PANEL'
  }
  | {
    type: 'SUMMARIZE_CURRENT_VIDEO'
    templateId?: string
  }
  | {
    type: 'GET_SUBTITLE_CURRENT_VIDEO'
  }

export interface RuntimeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export const ok = <T>(data: T): RuntimeResponse<T> => ({
  ok: true,
  data,
})

export const fail = (error: unknown): RuntimeResponse => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})
