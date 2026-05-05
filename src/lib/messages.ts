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
    type: 'OPEN_FLOATING_PANEL'
  }
  | {
    type: 'OPEN_FLOATING_SETTINGS'
  }
  | {
    type: 'GET_SUBTITLE_FOR_VIDEO'
    video: DetectedVideo
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
