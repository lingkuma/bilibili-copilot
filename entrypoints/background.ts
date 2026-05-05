import { browser } from 'wxt/browser'
import { defaultTemplates, findTemplate } from '../src/lib/ai/prompts'
import { summarizeSubtitle } from '../src/lib/ai/summarize'
import { getSubtitleForAI } from '../src/lib/bilibili/subtitle'
import { extractBvidFromUrl, extractPageFromUrl, resolveVideo } from '../src/lib/bilibili/video'
import { fail, ok, type RuntimeMessage } from '../src/lib/messages'
import { isAIConfigured, loadSettings } from '../src/lib/settings/storage'
import type { DetectedVideo, ResolvedVideo } from '../src/lib/types'

const tabVideos = new Map<number, DetectedVideo>()

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.sidePanel
      ?.setPanelBehavior?.({ openPanelOnActionClick: true })
      .catch(() => undefined)
  })

  browser.runtime.onMessage.addListener(async (message: RuntimeMessage, sender) => {
    try {
      if (message.type === 'VIDEO_DETECTED') {
        if (sender.tab?.id !== undefined) {
          tabVideos.set(sender.tab.id, message.video)
        }
        return ok(null)
      }

      if (message.type === 'OPEN_SIDE_PANEL') {
        if (sender.tab?.windowId !== undefined) {
          await browser.sidePanel.open({ windowId: sender.tab.windowId })
        }
        return ok(null)
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
