import { browser } from 'wxt/browser'
import { defaultTemplates, findTemplate } from '../src/lib/ai/prompts'
import { summarizeSubtitle, summarizeSubtitleStream } from '../src/lib/ai/summarize'
import { getSubtitleForAI } from '../src/lib/bilibili/subtitle'
import { extractBvidFromUrl, extractPageFromUrl, resolveVideo } from '../src/lib/bilibili/video'
import { fail, ok, type RuntimeMessage, type StreamPortEvent, type StreamPortRequest } from '../src/lib/messages'
import { isAIConfigured, loadSettings } from '../src/lib/settings/storage'
import type { DetectedVideo, ResolvedVideo } from '../src/lib/types'

const tabVideos = new Map<number, DetectedVideo>()

export default defineBackground(() => {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'bilibili-copilot-stream') {
      return
    }

    const abortController = new AbortController()
    port.onDisconnect.addListener(() => {
      abortController.abort()
    })

    port.onMessage.addListener(message => {
      void handleStreamRequest(port, message as StreamPortRequest, abortController.signal)
    })
  })

  browser.runtime.onMessage.addListener(async (message: RuntimeMessage, sender) => {
    try {
      if (message.type === 'VIDEO_DETECTED') {
        if (sender.tab?.id !== undefined) {
          tabVideos.set(sender.tab.id, message.video)
        }
        return ok(null)
      }

      if (message.type === 'GET_SUBTITLE_FOR_VIDEO') {
        const settings = await loadSettings()
        const video = await resolveVideo(message.video)
        const subtitle = await getSubtitleForAI(video, {
          language: settings.language,
          includeTimestamps: settings.includeTimestamps,
        })
        return ok({ video, subtitle })
      }

      if (message.type === 'SUMMARIZE_VIDEO') {
        const settings = await loadSettings()
        if (!isAIConfigured(settings)) {
          throw new Error('请先在设置里配置 AI API。')
        }

        const video = await resolveVideo(message.video)
        const subtitle = await getSubtitleForAI(video, {
          language: settings.language,
          includeTimestamps: settings.includeTimestamps,
        })
        if (!subtitle.available) {
          throw new Error(subtitle.reason)
        }

        const template = findTemplate(message.templateId ?? settings.defaultTemplateId)
        const summary = await summarizeSubtitle({
          settings,
          template,
          video,
          subtitleText: subtitle.text,
        })

        return ok({
          video,
          subtitle,
          template,
          summary,
          templates: defaultTemplates,
        })
      }

      if (message.type === 'GET_CURRENT_VIDEO') {
        return ok(await getActiveResolvedVideo())
      }

      if (message.type === 'GET_SUBTITLE_CURRENT_VIDEO') {
        const settings = await loadSettings()
        const video = await getActiveResolvedVideo()
        const subtitle = await getSubtitleForAI(video, {
          language: settings.language,
          includeTimestamps: settings.includeTimestamps,
        })
        return ok({ video, subtitle })
      }

      if (message.type === 'SUMMARIZE_CURRENT_VIDEO') {
        const settings = await loadSettings()
        if (!isAIConfigured(settings)) {
          throw new Error('请先在设置页配置 AI API。')
        }

        const video = await getActiveResolvedVideo()
        const subtitle = await getSubtitleForAI(video, {
          language: settings.language,
          includeTimestamps: settings.includeTimestamps,
        })
        if (!subtitle.available) {
          throw new Error(subtitle.reason)
        }

        const template = findTemplate(message.templateId ?? settings.defaultTemplateId)
        const summary = await summarizeSubtitle({
          settings,
          template,
          video,
          subtitleText: subtitle.text,
        })

        return ok({
          video,
          subtitle,
          template,
          summary,
          templates: defaultTemplates,
        })
      }

      return fail('Unknown message type.')
    } catch (error) {
      return fail(error)
    }
  })
})

const handleStreamRequest = async (
  port: Browser.runtime.Port,
  message: StreamPortRequest,
  signal: AbortSignal,
) => {
  try {
    if (message.type !== 'STREAM_SUMMARIZE_VIDEO') {
      throw new Error('Unknown stream message type.')
    }

    const settings = await loadSettings()
    if (!isAIConfigured(settings)) {
      throw new Error('请先在设置里配置 AI API。')
    }

    const video = await resolveVideo(message.video)
    const subtitle = await getSubtitleForAI(video, {
      language: settings.language,
      includeTimestamps: settings.includeTimestamps,
    })
    if (!subtitle.available) {
      throw new Error(subtitle.reason)
    }

    const template = findTemplate(message.templateId ?? settings.defaultTemplateId)
    safePost(port, {
      type: 'SUMMARY_STREAM_START',
      data: {
        video,
        subtitle,
        template,
        templates: defaultTemplates,
      },
    })

    const summary = await summarizeSubtitleStream(
      {
        settings,
        template,
        video,
        subtitleText: subtitle.text,
        signal,
      },
      content => {
        safePost(port, {
          type: 'SUMMARY_STREAM_DELTA',
          content,
        })
      },
    )

    safePost(port, {
      type: 'SUMMARY_STREAM_DONE',
      summary,
    })
  } catch (error) {
    if (signal.aborted) {
      return
    }

    safePost(port, {
      type: 'SUMMARY_STREAM_ERROR',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const safePost = (port: Browser.runtime.Port, message: StreamPortEvent) => {
  try {
    port.postMessage(message)
  } catch {
    // The content page may have navigated or closed the floating window.
  }
}

const getActiveTab = async () => {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })
  return tab
}

const getActiveResolvedVideo = async (): Promise<ResolvedVideo> => {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) {
    throw new Error('没有找到当前活动标签页。')
  }

  const detected = tabVideos.get(tab.id) ?? detectFromTabUrl(tab.url, tab.title)
  return resolveVideo(detected)
}

const detectFromTabUrl = (url: string, title?: string): DetectedVideo => ({
  bvid: extractBvidFromUrl(url),
  page: extractPageFromUrl(url),
  title,
  url,
})
