import { browser } from 'wxt/browser'
import { defaultTemplates, findTemplate } from '../src/lib/ai/prompts'
import { answerSubtitleQuestion, summarizeSubtitle, summarizeSubtitleStream } from '../src/lib/ai/summarize'
import { getSubtitleForAI } from '../src/lib/bilibili/subtitle'
import { extractBvidFromUrl, extractPageFromUrl, resolveVideo } from '../src/lib/bilibili/video'
import { deleteHistoryThread, getHistoryThread, listHistoryThreads, saveHistoryThread } from '../src/lib/history/storage'
import { fail, ok, type RuntimeMessage, type StreamPortEvent, type StreamPortRequest } from '../src/lib/messages'
import { buildTelegraphContent, collectShareImageEntries } from '../src/lib/share/telegraph'
import { isAIConfigured, loadSettings, saveSettings } from '../src/lib/settings/storage'
import type { DetectedVideo, ResolvedVideo, SubtitleForAI } from '../src/lib/types'

const tabVideos = new Map<number, DetectedVideo>()
const subtitleCache = new Map<string, Promise<SubtitlePayload>>()

interface SubtitlePayload {
  video: ResolvedVideo
  subtitle: SubtitleForAI
}

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
        return ok(await getCachedSubtitleForVideo(message.video, settings, message.force))
      }

      if (message.type === 'SUMMARIZE_VIDEO') {
        const settings = await loadSettings()
        if (!isAIConfigured(settings)) {
          throw new Error('请先在设置里配置 AI API。')
        }

        const { video, subtitle } = await getCachedSubtitleForVideo(message.video, settings)
        if (!subtitle.available) {
          throw new Error(subtitle.reason)
        }

        const template = findTemplate(message.templateId ?? settings.selectedTemplateId)
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
        return ok(await getCachedSubtitleForVideo(video, settings))
      }

      if (message.type === 'SUMMARIZE_CURRENT_VIDEO') {
        const settings = await loadSettings()
        if (!isAIConfigured(settings)) {
          throw new Error('请先在设置页配置 AI API。')
        }

        const detected = await getActiveResolvedVideo()
        const { video, subtitle } = await getCachedSubtitleForVideo(detected, settings)
        if (!subtitle.available) {
          throw new Error(subtitle.reason)
        }

        const template = findTemplate(message.templateId ?? settings.selectedTemplateId)
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
          imageLabels: Object.fromEntries(imageEntries.map(entry => [entry.key, entry.label])),
        })
        const accessToken = await ensureTelegraphAccessToken(settings)
        const page = await createTelegraphPage({
          accessToken,
          title: message.video.title,
          slugTitle: createTelegraphSlugTitle(message.video),
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

      if (message.type === 'SHARE_HISTORY_THREAD_TO_TELEGRAPH') {
        const settings = await loadSettings()
        const page = await createHistoryTelegraphPage(settings, message.thread)

        await browser.tabs.create({
          url: page.url,
        })

        return ok({
          url: page.url,
        })
      }

      if (message.type === 'ANSWER_SUBTITLE_QUESTION') {
        const settings = await loadSettings()
        if (!isAIConfigured(settings)) {
          throw new Error('请先在设置里配置 AI API。')
        }

        const { video, subtitle } = await getCachedSubtitleForVideo(message.video, settings)
        if (!subtitle.available) {
          throw new Error(subtitle.reason)
        }

        return ok({
          answer: await answerSubtitleQuestion({
            settings,
            video,
            subtitleText: subtitle.text,
            entries: message.entries,
            question: message.question,
          }),
        })
      }

      if (message.type === 'SAVE_HISTORY_THREAD') {
        await saveHistoryThread(message.thread)
        return ok(null)
      }

      if (message.type === 'GET_HISTORY_THREADS') {
        return ok(await listHistoryThreads())
      }

      if (message.type === 'GET_HISTORY_THREAD') {
        return ok(await getHistoryThread(message.id))
      }

      if (message.type === 'DELETE_HISTORY_THREAD') {
        await deleteHistoryThread(message.id)
        return ok(null)
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

    const { video, subtitle } = await getCachedSubtitleForVideo(message.video, settings)
    if (!subtitle.available) {
      throw new Error(subtitle.reason)
    }

    const template = findTemplate(message.templateId ?? settings.selectedTemplateId)
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

const getCachedSubtitleForVideo = async (
  detected: DetectedVideo,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  force = false,
): Promise<SubtitlePayload> => {
  const video = await resolveVideo(detected)
  const cacheKey = createSubtitleCacheKey(video, settings)
  let request = subtitleCache.get(cacheKey)
  if (!request || force) {
    const nextRequest = getSubtitleForAI(video, {
      language: settings.language,
      includeTimestamps: settings.includeTimestamps,
    })
      .then(subtitle => ({ video, subtitle }))
      .catch(error => {
        if (subtitleCache.get(cacheKey) === nextRequest) {
          subtitleCache.delete(cacheKey)
        }
        throw error
      })
    request = nextRequest
    subtitleCache.set(cacheKey, request)
  }
  return request
}

const createSubtitleCacheKey = (
  video: ResolvedVideo,
  settings: Awaited<ReturnType<typeof loadSettings>>,
) => {
  return [
    video.bvid,
    video.cid,
    video.page,
    settings.language.trim(),
    settings.includeTimestamps ? 'with-timestamps' : 'without-timestamps',
  ].join(':')
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
  slugTitle: string
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
      title: input.slugTitle,
      author_name: input.authorName,
      ...(input.authorUrl ? { author_url: input.authorUrl } : {}),
      content: JSON.stringify(input.content),
      return_content: 'false',
    }),
  })
  const payload = await response.json() as TelegraphResponse<{ path: string; url: string }>
  if (!payload.ok || !payload.result?.path || !payload.result.url) {
    throw new Error(payload.error ?? '创建 Telegraph 页面失败。')
  }
  return editTelegraphPage({
    accessToken: input.accessToken,
    path: payload.result.path,
    title: input.title,
    authorName: input.authorName,
    authorUrl: input.authorUrl,
    content: input.content,
  })
}

const editTelegraphPage = async (input: {
  accessToken: string
  path: string
  title: string
  authorName: string
  authorUrl: string
  content: ReturnType<typeof buildTelegraphContent>
}) => {
  const response = await fetch('https://api.telegra.ph/editPage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      access_token: input.accessToken,
      path: input.path,
      title: input.title,
      author_name: input.authorName,
      ...(input.authorUrl ? { author_url: input.authorUrl } : {}),
      content: JSON.stringify(input.content),
      return_content: 'false',
    }),
  })
  const payload = await response.json() as TelegraphResponse<{ url: string }>
  if (!payload.ok || !payload.result?.url) {
    throw new Error(payload.error ?? 'Edit Telegraph page failed.')
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

const createHistoryTelegraphPage = async (
  settings: Awaited<ReturnType<typeof loadSettings>>,
  thread: import('../src/lib/history/types').HistoryThread,
) => {
  const imageUrlsByEntry = new Map<string, Record<string, string>>()
  const imageLabelsByEntry = new Map<string, Record<string, string>>()

  for (const entry of thread.entries) {
    const snapshot = entry.images ?? {
      images: {},
      deletedImageKeys: {},
    }
    const imageEntries = collectShareImageEntries(entry.content, snapshot)
    const imageUrls = new Map<string, string>()

    await Promise.all(imageEntries.map(async imageEntry => {
      const url = await uploadCloudinaryImage(
        settings,
        imageEntry.dataUrl,
        createCloudinaryPublicId(thread.video, `${entry.id}-${imageEntry.key}`),
      )
      imageUrls.set(imageEntry.key, url)
    }))

    imageUrlsByEntry.set(entry.id, Object.fromEntries(imageUrls))
    imageLabelsByEntry.set(entry.id, Object.fromEntries(imageEntries.map(item => [item.key, item.label])))
  }

  const content = buildHistoryTelegraphContent(
    thread,
    imageUrlsByEntry,
    imageLabelsByEntry,
  )
  const accessToken = await ensureTelegraphAccessToken(settings)
  return createTelegraphPage({
    accessToken,
    title: thread.video.title,
    slugTitle: createTelegraphSlugTitle(thread.video),
    authorName: settings.telegraphAuthorName.trim() || 'Bilibili Copilot',
    authorUrl: settings.telegraphAuthorUrl.trim(),
    content,
  })
}

const buildHistoryTelegraphContent = (
  thread: import('../src/lib/history/types').HistoryThread,
  imageUrlsByEntry: Map<string, Record<string, string>>,
  imageLabelsByEntry: Map<string, Record<string, string>>,
) => {
  const content: ReturnType<typeof buildTelegraphContent> = [
    {
      tag: 'p',
      children: [
        'Source: ',
        {
          tag: 'a',
          attrs: {
            href: thread.video.url,
          },
          children: [thread.video.title],
        },
      ],
    },
  ]

  thread.entries.forEach(entry => {
    content.push({
      tag: 'h3',
      children: [getHistoryEntryTitle(entry)],
    })
    content.push(...buildTelegraphContent({
      markdown: entry.content,
      video: thread.video,
      imageUrls: imageUrlsByEntry.get(entry.id) ?? {},
      imageLabels: imageLabelsByEntry.get(entry.id) ?? {},
      includeSource: false,
    }))
  })

  return content
}

const getHistoryEntryTitle = (entry: import('../src/lib/history/types').HistoryEntry) => {
  if (entry.kind === 'summary') {
    return 'AI 总结'
  }

  return entry.role === 'user' ? '我的问题' : 'AI 回答'
}

const createTelegraphSlugTitle = (video: ResolvedVideo) => {
  return `${video.bvid}-${Math.random().toString(36).slice(2, 8)}`
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
