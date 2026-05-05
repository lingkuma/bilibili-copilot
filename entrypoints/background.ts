import { browser } from 'wxt/browser'
import { defaultTemplates, findTemplate } from '../src/lib/ai/prompts'
import { summarizeSubtitle, summarizeSubtitleStream } from '../src/lib/ai/summarize'
import { getSubtitleForAI } from '../src/lib/bilibili/subtitle'
import { extractBvidFromUrl, extractPageFromUrl, resolveVideo } from '../src/lib/bilibili/video'
import { fail, ok, type RuntimeMessage, type StreamPortEvent, type StreamPortRequest } from '../src/lib/messages'
import { buildTelegraphContent, collectShareImageEntries } from '../src/lib/share/telegraph'
import { isAIConfigured, loadSettings, saveSettings } from '../src/lib/settings/storage'
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

      if (message.type === 'SHARE_SUMMARY_TO_TELEGRAPH') {
        const settings = await loadSettings()
        const imageEntries = collectShareImageEntries(message.summary, message.images)
        const imageUrls = new Map<string, string>()

        await Promise.all(imageEntries.map(async entry => {
          const url = await uploadCloudinaryImage(settings, entry.dataUrl, createCloudinaryPublicId(message.video, entry.key))
          imageUrls.set(entry.key, url)
        }))

        const content = buildTelegraphContent({
          markdown: message.summary,
          video: message.video,
          imageUrls: Object.fromEntries(imageUrls),
        })
        const accessToken = await ensureTelegraphAccessToken(settings)
        const page = await createTelegraphPage({
          accessToken,
          title: message.video.title,
          authorName: settings.telegraphAuthorName.trim() || 'Bilibili Copilot',
          authorUrl: settings.telegraphAuthorUrl.trim(),
          content,
        })

        await browser.tabs.create({
          url: page.url,
        })

        return ok({
          url: page.url,
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

const ensureTelegraphAccessToken = async (settings: Awaited<ReturnType<typeof loadSettings>>) => {
  if (settings.telegraphAccessToken.trim().length > 0) {
    return settings.telegraphAccessToken.trim()
  }

  const shortName = settings.telegraphShortName.trim() || 'bilibili-copilot'
  const authorName = settings.telegraphAuthorName.trim() || 'Bilibili Copilot'
  const authorUrl = settings.telegraphAuthorUrl.trim()
  const response = await fetch('https://api.telegra.ph/createAccount', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      short_name: shortName,
      author_name: authorName,
      ...(authorUrl ? { author_url: authorUrl } : {}),
    }),
  })
  const payload = await response.json() as TelegraphResponse<{ access_token: string }>
  if (!payload.ok || !payload.result?.access_token) {
    throw new Error(payload.error ?? '创建 Telegraph 账户失败。')
  }

  await saveSettings({
    ...settings,
    telegraphAccessToken: payload.result.access_token,
    telegraphShortName: shortName,
    telegraphAuthorName: authorName,
    telegraphAuthorUrl: authorUrl,
  })
  return payload.result.access_token
}

const createTelegraphPage = async (input: {
  accessToken: string
  title: string
  authorName: string
  authorUrl: string
  content: ReturnType<typeof buildTelegraphContent>
}) => {
  const response = await fetch('https://api.telegra.ph/createPage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      access_token: input.accessToken,
      title: input.title,
      author_name: input.authorName,
      ...(input.authorUrl ? { author_url: input.authorUrl } : {}),
      content: JSON.stringify(input.content),
      return_content: 'false',
    }),
  })
  const payload = await response.json() as TelegraphResponse<{ url: string }>
  if (!payload.ok || !payload.result?.url) {
    throw new Error(payload.error ?? '创建 Telegraph 页面失败。')
  }
  return payload.result
}

const uploadCloudinaryImage = async (
  settings: Awaited<ReturnType<typeof loadSettings>>,
  dataUrl: string,
  publicId: string,
) => {
  const blob = dataUrlToBlob(dataUrl)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await createCloudinarySignature({
    publicId,
    timestamp,
    apiSecret: settings.cloudinaryApiSecret.trim(),
  })

  const formData = new FormData()
  formData.append('file', blob)
  formData.append('api_key', settings.cloudinaryApiKey.trim())
  formData.append('timestamp', String(timestamp))
  formData.append('public_id', publicId)
  formData.append('signature', signature)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${settings.cloudinaryCloudName.trim()}/image/upload`, {
    method: 'POST',
    body: formData,
  })
  const payload = await response.json() as CloudinaryUploadResponse
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? '上传到 Cloudinary 失败。')
  }
  if (!payload.secure_url) {
    throw new Error('Cloudinary 未返回图片地址。')
  }
  return payload.secure_url
}

const createCloudinaryPublicId = (video: ResolvedVideo, key: string) => {
  const shareId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `bilibili-copilot/${video.bvid}/${shareId}/${key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

const createCloudinarySignature = async (input: {
  publicId: string
  timestamp: number
  apiSecret: string
}) => {
  const base = `public_id=${input.publicId}&timestamp=${input.timestamp}${input.apiSecret}`
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(base))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const dataUrlToBlob = (dataUrl: string) => {
  const match = /^data:([^,]*),(.*)$/.exec(dataUrl)
  if (!match?.[2]) {
    throw new Error('图片数据无效。')
  }

  const metadata = match[1] ?? ''
  const data = match[2]
  if (metadata.includes(';base64')) {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], {
      type: metadata.replace(/;base64$/, '') || 'application/octet-stream',
    })
  }

  return new Blob([new TextEncoder().encode(decodeURIComponent(data))], {
    type: metadata || 'application/octet-stream',
  })
}

type TelegraphResponse<T> = {
  ok: boolean
  result?: T
  error?: string
}

type CloudinaryUploadResponse = {
  secure_url?: string
  error?: {
    message?: string
  }
}
