<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { browser } from 'wxt/browser'
  import { defaultTemplates, getPromptTemplates } from '../../src/lib/ai/prompts'
  import { extractBvidFromUrl, extractPageFromUrl, stripBilibiliTitleSuffix } from '../../src/lib/bilibili/video'
  import { createZipBlob, type ZipFile } from '../../src/lib/export/zip'
  import {
    createManualBlockImageKey,
    createManualListItemImageKey,
    parseConstrainedMarkdown,
    type InlinePart,
    type MarkdownBlock,
  } from '../../src/lib/markdown/parse'
  import type { HistoryEntry, HistoryThread, HistoryThreadSummary } from '../../src/lib/history/types'
  import { createHistoryThreadId } from '../../src/lib/history/storage'
  import type { RuntimeMessage, RuntimeResponse, StreamPortEvent } from '../../src/lib/messages'
  import { defaultSettings, loadSettings, saveSettings } from '../../src/lib/settings/storage'
  import type { CopilotSettings, DetectedVideo, PromptTemplate, ResolvedVideo, SubtitleForAI, SubtitleInfo } from '../../src/lib/types'
  import MarkdownView from './MarkdownView.svelte'

  interface SubtitlePayload {
    video: ResolvedVideo
    subtitle: SubtitleForAI
  }

  interface StreamStartPayload extends SubtitlePayload {
    template: PromptTemplate
  }

  type ExportImageState = {
    status: 'idle' | 'loading' | 'loaded' | 'error'
    source: 'ai' | 'manual'
    seconds: number
    label: string
    dataUrl?: string
    error?: string
  }

  type ExportImageSnapshot = {
    images: Record<string, ExportImageState>
    deletedImageKeys: Record<string, true>
  }

  let expanded = $state(false)
  let settingsOpen = $state(false)
  let video = $state<ResolvedVideo | null>(null)
  let subtitle = $state<SubtitleForAI | null>(null)
  let summary = $state('')
  let selectedTemplateId = $state('brief-outline')
  let selectedSubtitleLanguage = $state('')
  let subtitleLoading = $state(false)
  let summaryLoading = $state(false)
  let loading = $derived(subtitleLoading || summaryLoading)
  let saving = $state(false)
  let saved = $state(false)
  let exporting = $state(false)
  let sharing = $state(false)
  let sharedUrl = $state('')
  let sharedCopied = $state(false)
  let error = $state('')
  let settings = $state<CopilotSettings>({ ...defaultSettings })
  let viewMode = $state<'main' | 'history' | 'prompt-manager'>('main')
  let currentThread = $state<HistoryThread | null>(null)
  let historyThreads = $state<HistoryThreadSummary[]>([])
  let historyLoading = $state(false)
  let chatInput = $state('')
  let chatLoading = $state(false)
  let exportKeepTimestamps = $state(true)
  let exportKeepImageTags = $state(false)

  let lastUrl = ''
  let intervalId: number | undefined
  let streamPort = $state<ReturnType<typeof browser.runtime.connect> | null>(null)
  let subtitleRequestId = 0
  let settingsSaveTimeout: number | undefined
  let savedResetTimeout: number | undefined
  let copiedResetTimeout: number | undefined
  let settingsSaveVersion = 0
  let frameCaptureQueue = Promise.resolve()
  let autoSummaryTimeout: number | undefined
  let lastDetectedVideoKey = ''
  let lastAutoSummaryKey = ''
  let promptTemplates = $derived(getPromptTemplates(settings.customPromptTemplates))

  onMount(() => {
    void initialize()
    const messageListener = (message: RuntimeMessage) => {
      if (message.type === 'OPEN_FLOATING_PANEL') {
        expanded = true
        settingsOpen = false
        void ensureSubtitleLoaded()
      }

      if (message.type === 'OPEN_FLOATING_SETTINGS') {
        expanded = true
        settingsOpen = true
      }
    }
    browser.runtime.onMessage.addListener(messageListener)

    intervalId = window.setInterval(() => {
      if (location.href !== lastUrl) {
        handleUrlChange()
      }
    }, 800)

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
      }
      if (settingsSaveTimeout !== undefined) {
        window.clearTimeout(settingsSaveTimeout)
      }
      if (savedResetTimeout !== undefined) {
        window.clearTimeout(savedResetTimeout)
      }
      if (copiedResetTimeout !== undefined) {
        window.clearTimeout(copiedResetTimeout)
      }
      if (autoSummaryTimeout !== undefined) {
        window.clearTimeout(autoSummaryTimeout)
      }
      browser.runtime.onMessage.removeListener(messageListener)
      closeStream()
    }
  })

  const initialize = async () => {
    settings = await loadSettings()
    selectedTemplateId = settings.selectedTemplateId
    selectedSubtitleLanguage = settings.language.trim()
    ensureSelectedTemplate()
    handleUrlChange()
  }

  const ensureSelectedTemplate = () => {
    if (promptTemplates.some(template => template.id === selectedTemplateId)) {
      return
    }

    selectedTemplateId = defaultSettings.selectedTemplateId
    settings.selectedTemplateId = defaultSettings.selectedTemplateId
  }

  const handleUrlChange = () => {
    const detected = detectVideo()
    const detectedKey = detected.bvid ? createDetectedVideoKey(detected) : ''
    lastUrl = location.href
    if (detectedKey && detectedKey === lastDetectedVideoKey) {
      void browser.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        video: detected,
      })
      return
    }

    lastDetectedVideoKey = detectedKey
    video = null
    subtitle = null
    selectedSubtitleLanguage = settings.language.trim()
    summary = ''
    currentThread = null
    chatInput = ''
    chatLoading = false
    viewMode = 'main'
    error = ''
    closeStream()
    summaryLoading = false
    subtitleRequestId += 1
    subtitleLoading = false

    if (detected.bvid) {
      void browser.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        video: detected,
      })
    }

    if (detected.bvid && settings.autoSummaryEnabled) {
      scheduleAutoSummary(detected)
    } else if (detected.bvid) {
      void ensureSubtitleLoaded()
    }
  }

  const detectVideo = (): DetectedVideo => ({
    bvid: extractBvidFromUrl(location.href),
    page: extractPageFromUrl(location.href),
    title: stripBilibiliTitleSuffix(document.title),
    url: location.href,
  })

  const unwrap = <T,>(response: RuntimeResponse<T>) => {
    if (!response.ok) {
      throw new Error(response.error ?? '操作失败。')
    }
    return response.data as T
  }

  const ensureSubtitleLoaded = async () => {
    if (loading || video || subtitle) {
      return
    }
    await refreshSubtitle(false)
  }

  const scheduleAutoSummary = (detected: DetectedVideo) => {
    const key = createDetectedVideoKey(detected)
    if (lastAutoSummaryKey === key) {
      return
    }

    lastAutoSummaryKey = key
    expanded = true
    settingsOpen = false
    viewMode = 'main'

    if (autoSummaryTimeout !== undefined) {
      window.clearTimeout(autoSummaryTimeout)
    }

    autoSummaryTimeout = window.setTimeout(() => {
      autoSummaryTimeout = undefined
      const current = detectVideo()
      if (!settings.autoSummaryEnabled || !current.bvid || createDetectedVideoKey(current) !== key) {
        return
      }

      void summarize()
    }, 400)
  }

  const createDetectedVideoKey = (detected: DetectedVideo) => {
    return `${detected.bvid ?? ''}:p${detected.page ?? 1}`
  }

  const openPanel = () => {
    expanded = true
    settingsOpen = false
    if (!video && !subtitle) {
      void ensureSubtitleLoaded()
    }
  }

  const getRequestedSubtitleLanguage = () => {
    return subtitle?.selected?.lan ?? (selectedSubtitleLanguage || settings.language.trim())
  }

  const formatSubtitleOption = (item: SubtitleInfo) => {
    const name = item.lan_doc.trim() || item.lan
    return name === item.lan ? item.lan : `${name} (${item.lan})`
  }

  const selectSubtitleLanguage = (event: Event) => {
    const language = (event.currentTarget as HTMLSelectElement).value
    if (!language || language === subtitle?.selected?.lan || loading) {
      return
    }

    selectedSubtitleLanguage = language
    void refreshSubtitle(true, language)
  }

  const refreshSubtitle = async (forceOrEvent: boolean | Event = true, language = getRequestedSubtitleLanguage()) => {
    const force = typeof forceOrEvent === 'boolean' ? forceOrEvent : true
    const requestId = ++subtitleRequestId
    const requestUrl = location.href
    subtitleLoading = true
    error = ''
    try {
      const detected = detectVideo()
      if (!detected.bvid) {
        throw new Error('当前页面不是可识别的 Bilibili 视频页。')
      }

      const response = await browser.runtime.sendMessage({
        type: 'GET_SUBTITLE_FOR_VIDEO',
        video: detected,
        force,
        language,
      }) as RuntimeResponse<SubtitlePayload>
      const payload = unwrap(response)
      if (requestId !== subtitleRequestId || requestUrl !== location.href) {
        return
      }
      video = payload.video
      subtitle = payload.subtitle
      selectedSubtitleLanguage = payload.subtitle.selected?.lan ?? language
    } catch (currentError) {
      if (requestId === subtitleRequestId && requestUrl === location.href) {
        error = currentError instanceof Error ? currentError.message : String(currentError)
      }
    } finally {
      if (requestId === subtitleRequestId) {
        subtitleLoading = false
      }
    }
  }

  const summarize = async () => {
    closeStream()
    summaryLoading = true
    error = ''
    summary = ''
    try {
      const detected = detectVideo()
      if (!detected.bvid) {
        throw new Error('当前页面不是可识别的 Bilibili 视频页。')
      }

      const port = browser.runtime.connect({
        name: 'bilibili-copilot-stream',
      })
      streamPort = port

      port.onMessage.addListener((message: StreamPortEvent) => {
        if (message.type === 'SUMMARY_STREAM_START') {
          const payload = message.data as StreamStartPayload
          video = payload.video
          subtitle = payload.subtitle
          selectedSubtitleLanguage = payload.subtitle.selected?.lan ?? selectedSubtitleLanguage
        }

        if (message.type === 'SUMMARY_STREAM_DELTA') {
          summary += message.content
        }

        if (message.type === 'SUMMARY_STREAM_DONE') {
          summary = message.summary
          summaryLoading = false
          appendHistoryEntry({
            id: createEntryId('summary'),
            kind: 'summary',
            createdAt: Date.now(),
            content: message.summary,
            templateId: selectedTemplateId,
            images: {
              images: {},
              deletedImageKeys: {},
            },
          })
          closeStream()
        }

        if (message.type === 'SUMMARY_STREAM_ERROR') {
          error = message.error
          summaryLoading = false
          closeStream()
        }
      })

      port.onDisconnect.addListener(() => {
        if (streamPort === port) {
          streamPort = null
          summaryLoading = false
        }
      })

      port.postMessage({
        type: 'STREAM_SUMMARIZE_VIDEO',
        video: detected,
        templateId: selectedTemplateId,
        language: getRequestedSubtitleLanguage(),
      })
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
      summaryLoading = false
      closeStream()
    }
  }

  const closeStream = () => {
    if (!streamPort) {
      return
    }

    try {
      streamPort.disconnect()
    } catch {
      // The port may already be closed after a navigation or stream completion.
    } finally {
      streamPort = null
    }
  }

  const seekVideo = (seconds: number) => {
    const player = document.querySelector('video') as HTMLVideoElement | null
    if (!player) {
      error = '没有找到当前页面的视频播放器。'
      return
    }

    player.currentTime = seconds
    const controller = player.closest('.bpx-player-container')
    controller?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }

  const getCurrentVideoSeconds = () => {
    const player = document.querySelector('video') as HTMLVideoElement | null
    if (!player) {
      throw new Error('没有找到当前页面的视频播放器。')
    }

    return Math.max(0, player.currentTime || 0)
  }

  const captureVideoFrame = (seconds: number) => {
    const request = frameCaptureQueue.then(
      () => captureVideoFrameNow(seconds),
      () => captureVideoFrameNow(seconds),
    )
    frameCaptureQueue = request.then(() => undefined, () => undefined)
    return request
  }

  const captureVideoFrameNow = async (seconds: number) => {
    const player = document.querySelector('video') as HTMLVideoElement | null
    if (!player) {
      throw new Error('没有找到当前页面的视频播放器。')
    }

    if (!player.videoWidth || !player.videoHeight) {
      throw new Error('播放器画面尚未加载完成。')
    }

    const originalTime = player.currentTime
    const wasPaused = player.paused

    try {
      if (!wasPaused) {
        player.pause()
      }

      const target = await seekTo(player, seconds)
      await waitForDrawableFrame(player, target)

      const canvas = document.createElement('canvas')
      canvas.width = player.videoWidth
      canvas.height = player.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('当前浏览器无法创建截图画布。')
      }

      context.drawImage(player, 0, 0, canvas.width, canvas.height)

      try {
        return canvas.toDataURL('image/jpeg', 0.86)
      } catch {
        throw new Error('当前视频源不允许截图。')
      }
    } finally {
      await seekTo(player, originalTime).catch(() => {
        player.currentTime = originalTime
      })
      if (!wasPaused) {
        void player.play().catch(() => undefined)
      }
    }
  }

  const seekTo = async (player: HTMLVideoElement, seconds: number) => {
    const duration = Number.isFinite(player.duration) ? player.duration : seconds
    const target = Math.max(0, Math.min(seconds, duration))

    if (Math.abs(player.currentTime - target) < 0.15 && player.readyState >= 2) {
      return target
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('视频定位超时。'))
      }, 8000)

      const cleanup = () => {
        window.clearTimeout(timeout)
        player.removeEventListener('seeked', handleSeeked)
        player.removeEventListener('error', handleError)
      }

      const handleSeeked = () => {
        cleanup()
        resolve()
      }

      const handleError = () => {
        cleanup()
        reject(new Error('视频定位失败。'))
      }

      player.addEventListener('seeked', handleSeeked, { once: true })
      player.addEventListener('error', handleError, { once: true })

      try {
        player.currentTime = target
      } catch (seekError) {
        cleanup()
        reject(seekError)
      }
    })

    return target
  }

  const waitForDrawableFrame = async (player: HTMLVideoElement, target: number) => {
    const video = player as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: (now: number, metadata: { mediaTime: number }) => void,
      ) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }

    if (!video.requestVideoFrameCallback) {
      await waitForAnimationFrame()
      await waitForAnimationFrame()
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      let handle: number | undefined
      const deadline = Date.now() + 700
      const timeout = window.setTimeout(() => {
        settle()
      }, 700)

      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        window.clearTimeout(timeout)
        if (handle !== undefined) {
          video.cancelVideoFrameCallback?.(handle)
        }
        resolve()
      }

      const requestFrame = () => {
        handle = video.requestVideoFrameCallback?.((_now, metadata) => {
          if (Math.abs(metadata.mediaTime - target) < 0.25 || Date.now() >= deadline) {
            settle()
            return
          }
          requestFrame()
        })
      }

      requestFrame()
    })
  }

  const waitForAnimationFrame = async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  }

  const exportSummaryZip = () => {
    if (!currentThread || currentThread.entries.length === 0) {
      return
    }

    exporting = true
    error = ''
    try {
      const files = buildExportFiles()
      const zip = createZipBlob(files)
      downloadBlob(zip, `${video?.bvid ?? 'bilibili-note'}.zip`)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      exporting = false
    }
  }

  const shareSummaryToTelegraph = async () => {
    if (!currentThread || currentThread.entries.length === 0) {
      return
    }

    sharing = true
    sharedUrl = ''
    sharedCopied = false
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'SHARE_HISTORY_THREAD_TO_TELEGRAPH',
        thread: $state.snapshot(currentThread),
      }) as RuntimeResponse<{ url: string; telegramError?: string }>
      const payload = unwrap(response)
      sharedUrl = payload.url
      if (payload.telegramError) {
        error = payload.telegramError
      }
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      sharing = false
    }
  }

  const copySharedUrl = async () => {
    if (!sharedUrl) {
      return
    }

    try {
      await writeClipboardText(sharedUrl)
      sharedCopied = true
      if (copiedResetTimeout !== undefined) {
        window.clearTimeout(copiedResetTimeout)
      }
      copiedResetTimeout = window.setTimeout(() => {
        sharedCopied = false
        copiedResetTimeout = undefined
      }, 1600)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }

  const writeClipboardText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch {
        // Fall back to the legacy copy command below.
      }
    }

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.append(textarea)
    textarea.select()

    try {
      if (!document.execCommand('copy')) {
        throw new Error('复制链接失败。')
      }
    } finally {
      textarea.remove()
    }
  }

  const handleEntryImagesChange = (entryId: string, snapshot: ExportImageSnapshot) => {
    if (!currentThread) {
      return
    }

    const currentEntry = currentThread.entries.find(entry => entry.id === entryId)
    if (currentEntry?.images && imageSnapshotsEqual(currentEntry.images, snapshot)) {
      return
    }

    const entries = currentThread.entries.map(entry => {
      if (entry.id !== entryId) {
        return entry
      }

      return {
        ...entry,
        images: snapshot,
      }
    })

    currentThread = {
      ...currentThread,
      entries,
      updatedAt: Date.now(),
    }
    void persistHistoryThread()
  }

  const imageSnapshotsEqual = (left: ExportImageSnapshot, right: ExportImageSnapshot) => {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  const loadHistoryThreads = async () => {
    historyLoading = true
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_HISTORY_THREADS',
      }) as RuntimeResponse<HistoryThreadSummary[]>
      historyThreads = unwrap(response)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      historyLoading = false
    }
  }

  const openHistory = () => {
    viewMode = 'history'
    settingsOpen = false
    void loadHistoryThreads()
  }

  const openPromptManager = () => {
    viewMode = 'prompt-manager'
    settingsOpen = false
    error = ''
  }

  const openCurrentView = () => {
    viewMode = 'main'
    settingsOpen = false
  }

  const createCustomTemplateId = () => {
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  const addCustomPromptTemplate = () => {
    const template: PromptTemplate = {
      id: createCustomTemplateId(),
      name: '自定义大纲',
      description: '按你的习惯输出视频大纲。',
      instruction: `请根据下面的 Bilibili 视频字幕生成 Markdown 大纲。

要求：
1. 用中文回答。
2. 标题和关键条目尽量保留时间戳，单点时间使用 [MM:SS] 或 [HH:MM:SS]。
3. 如果内容覆盖一段连续区间，可以使用 [MM:SS-MM:SS] 或 [HH:MM:SS-HH:MM:SS]。
4. 如果某个章节适合配代表画面，请在章节标题下方单独输出一行图片标签，格式为：[<image>@MM:SS]。
5. 图片标签必须独占一行，不要和标题或正文写在同一行。
6. 不要输出 JSON，不要使用表格。`,
    }

    settings.customPromptTemplates = [
      ...settings.customPromptTemplates,
      template,
    ]
    selectedTemplateId = template.id
    settings.selectedTemplateId = template.id
    scheduleSettingsSave(0)
  }

  const deleteCustomPromptTemplate = (id: string) => {
    settings.customPromptTemplates = settings.customPromptTemplates.filter(template => template.id !== id)
    if (selectedTemplateId === id || settings.selectedTemplateId === id) {
      selectedTemplateId = defaultSettings.selectedTemplateId
      settings.selectedTemplateId = defaultSettings.selectedTemplateId
    }
    scheduleSettingsSave(0)
  }

  const updateCustomPromptTemplate = (
    id: string,
    field: 'name' | 'description' | 'instruction',
    value: string,
  ) => {
    settings.customPromptTemplates = settings.customPromptTemplates.map(template => (
      template.id === id
        ? {
            ...template,
            [field]: value,
          }
        : template
    ))
    scheduleSettingsSave()
  }

  const startNewConversation = () => {
    closeStream()
    currentThread = null
    summary = ''
    chatInput = ''
    sharedUrl = ''
    sharedCopied = false
    error = ''
    summaryLoading = false
    chatLoading = false
    viewMode = 'main'
    settingsOpen = false
  }

  const selectHistoryThread = async (id: string) => {
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_HISTORY_THREAD',
        id,
      }) as RuntimeResponse<HistoryThread | null>
      const thread = unwrap(response)
      if (!thread) {
        throw new Error('没有找到这条历史记录。')
      }

      currentThread = thread
      video = thread.video
      subtitle = thread.subtitle ?? subtitle
      const latestSummary = [...thread.entries].reverse().find(entry => entry.kind === 'summary')
      summary = latestSummary?.content ?? ''
      viewMode = 'main'
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }

  const deleteHistory = async (id: string) => {
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'DELETE_HISTORY_THREAD',
        id,
      }) as RuntimeResponse<null>
      unwrap(response)
      historyThreads = historyThreads.filter(thread => thread.id !== id)
      if (currentThread?.id === id) {
        currentThread = null
        summary = ''
      }
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }

  const askQuestion = async () => {
    const question = chatInput.trim()
    if (!question || !video || chatLoading) {
      return
    }

    const previousEntries = currentThread?.entries ?? []
    const userEntry: HistoryEntry = {
      id: createEntryId('user'),
      kind: 'chat',
      role: 'user',
      createdAt: Date.now(),
      content: question,
    }

    appendHistoryEntry(userEntry)
    chatInput = ''
    chatLoading = true
    error = ''

    try {
      const response = await browser.runtime.sendMessage({
        type: 'ANSWER_SUBTITLE_QUESTION',
        video,
        question,
        entries: previousEntries,
        language: getRequestedSubtitleLanguage(),
      }) as RuntimeResponse<{ answer: string }>
      const payload = unwrap(response)
      appendHistoryEntry({
        id: createEntryId('assistant'),
        kind: 'chat',
        role: 'assistant',
        createdAt: Date.now(),
        content: payload.answer,
        images: {
          images: {},
          deletedImageKeys: {},
        },
      })
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      chatLoading = false
    }
  }

  const appendHistoryEntry = (entry: HistoryEntry) => {
    if (!video) {
      return
    }

    const now = Date.now()
    const thread: HistoryThread = currentThread && isSameVideo(currentThread.video, video)
      ? currentThread
      : {
          id: createHistoryThreadId(video),
          video,
          subtitle: subtitle ?? undefined,
          entries: [],
          createdAt: now,
          updatedAt: now,
        }

    currentThread = {
      ...thread,
      video,
      subtitle: subtitle ?? thread.subtitle,
      entries: [...thread.entries, entry],
      updatedAt: now,
    }
    void persistHistoryThread()
  }

  const isSameVideo = (left: ResolvedVideo, right: ResolvedVideo) => {
    return left.bvid === right.bvid
      && left.page === right.page
      && left.cid === right.cid
  }

  const persistHistoryThread = async () => {
    if (!currentThread || currentThread.entries.length === 0) {
      return
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: 'SAVE_HISTORY_THREAD',
        thread: $state.snapshot(currentThread),
      }) as RuntimeResponse<null>
      unwrap(response)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }

  const createEntryId = (prefix: string) => {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  const buildExportFiles = (): ZipFile[] => {
    const assets: ZipFile[] = []
    const assetPaths = new Map<string, string>()
    const sections: string[] = []

    currentThread?.entries.forEach(entry => {
      sections.push(`## ${getExportEntryTitle(entry)}`)
      const blocks = parseConstrainedMarkdown(entry.content)
      const entrySections: string[] = []
      const imageSnapshot = entry.images ?? {
        images: {},
        deletedImageKeys: {},
      }

      blocks.forEach((block, index) => {
        const lines = renderExportBlock(block, blocks, index, assets, assetPaths, imageSnapshot)
        if (lines.length > 0) {
          entrySections.push(lines.join('\n'))
        }
      })

      if (entrySections.length > 0) {
        sections.push(entrySections.join('\n\n'))
      }
    })

    const note = `${sections.join('\n\n').trim()}\n`
    return [
      {
        path: 'note.md',
        data: note,
      },
      ...assets,
    ]
  }

  const renderExportBlock = (
    block: MarkdownBlock,
    blocks: MarkdownBlock[],
    index: number,
    assets: ZipFile[],
    assetPaths: Map<string, string>,
    imageSnapshot: ExportImageSnapshot,
  ) => {
    if (block.type === 'heading') {
      const heading = `${'#'.repeat(block.level)} ${renderInlineParts(block.parts)}`
      const lines = heading.trim() ? [heading] : []

      if (block.level > 1) {
        const imageKey = createHeadingImageKey(block.parts)
        if (imageKey && !hasFollowingExportImageBlock(blocks, index, imageKey)) {
          lines.push(...renderImageReference(imageKey, '', assets, assetPaths, imageSnapshot))
        }
      }

      lines.push(...renderImageReference(createManualBlockImageKey(index), '', assets, assetPaths, imageSnapshot))

      return lines
    }

    if (block.type === 'list') {
      const lines: string[] = []
      block.items.forEach((item, itemIndex) => {
        const text = renderInlineParts(item)
        if (text) {
          lines.push(`- ${text}`)
        }
        lines.push(...renderImageReference(createManualListItemImageKey(index, itemIndex), '', assets, assetPaths, imageSnapshot))
      })
      return lines
    }

    if (block.type === 'image') {
      const imageKey = createImageKeyForExportBlock(blocks, index)
      return renderImageReference(imageKey, block.label, assets, assetPaths, imageSnapshot)
    }

    const paragraph = renderInlineParts(block.parts)
    const lines = paragraph ? [paragraph] : []
    lines.push(...renderImageReference(createManualBlockImageKey(index), '', assets, assetPaths, imageSnapshot))
    return lines
  }

  const renderInlineParts = (parts: InlinePart[]) => {
    const text = parts
      .map(part => {
        if (part.type === 'timestamp') {
          return exportKeepTimestamps ? `[${part.label}]` : ''
        }

        if (part.type === 'strong') {
          return `**${part.text}**`
        }

        return part.text
      })
      .join('')

    return normalizeMarkdownText(text)
  }

  const renderImageReference = (
    key: string,
    fallbackLabel: string,
    assets: ZipFile[],
    assetPaths: Map<string, string>,
    imageSnapshot: ExportImageSnapshot,
  ) => {
    if (imageSnapshot.deletedImageKeys[key]) {
      return []
    }

    const image = imageSnapshot.images[key]
    const imageLabel = image?.label || fallbackLabel
    const lines: string[] = []

    if (image?.status === 'loaded' && image.dataUrl) {
      let assetPath = assetPaths.get(key)
      if (!assetPath) {
        const imageNumber = assetPaths.size + 1
        const filename = imageNumber === 1
          ? 'image.jpg'
          : `image-${String(imageNumber).padStart(2, '0')}.jpg`
        assetPath = `assets/${filename}`
        assetPaths.set(key, assetPath)
        assets.push({
          path: assetPath,
          data: dataUrlToBytes(image.dataUrl),
        })
      }
      lines.push(`![${escapeImageAlt(imageLabel)}](${assetPath})`)
    }

    if (exportKeepImageTags && imageLabel) {
      lines.push(`[<image>@${imageLabel}]`)
    }

    return lines.filter(Boolean)
  }

  const createHeadingImageKey = (parts: InlinePart[]) => {
    const timestamp = parts.find(part => part.type === 'timestamp')
    const heading = parts
      .map(part => {
        if (part.type === 'timestamp') {
          return part.label
        }
        return part.text
      })
      .join('')
      .trim()

    return timestamp ? `section:${timestamp.startSeconds}:${heading}` : ''
  }

  const createImageKeyForExportBlock = (blocks: MarkdownBlock[], index: number) => {
    for (let currentIndex = index - 1; currentIndex >= 0; currentIndex--) {
      const block = blocks[currentIndex]
      if (block?.type === 'heading') {
        const key = createHeadingImageKey(block.parts)
        if (key) {
          return key
        }
      }
    }

    const block = blocks[index]
    return block?.type === 'image' ? `image:${index}:${block.label}` : `image:${index}`
  }

  const hasFollowingExportImageBlock = (blocks: MarkdownBlock[], index: number, key: string) => {
    const nextBlock = blocks[index + 1]
    return nextBlock?.type === 'image' && createImageKeyForExportBlock(blocks, index + 1) === key
  }

  const getExportEntryTitle = (entry: HistoryEntry) => {
    if (entry.kind === 'summary') {
      return 'AI 总结'
    }

    return entry.role === 'user' ? '我的问题' : 'AI 回答'
  }

  const formatDateTime = (value: number) => {
    return new Date(value).toLocaleString()
  }

  const normalizeMarkdownText = (text: string) => {
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:!?，。；：！？、])/g, '$1')
      .trim()
  }

  const escapeImageAlt = (text: string) => {
    return text.replace(/[[\]\\]/g, '\\$&')
  }

  const dataUrlToBytes = (dataUrl: string) => {
    const match = /^data:([^,]*),(.*)$/.exec(dataUrl)
    if (!match?.[2]) {
      throw new Error('导出的图片数据无效。')
    }

    const metadata = match[1] ?? ''
    const data = match[2]
    if (metadata.includes(';base64')) {
      const binary = window.atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }

    return new TextEncoder().encode(decodeURIComponent(data))
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }

  const scheduleSettingsSave = (delay = 400) => {
    const version = ++settingsSaveVersion
    saving = true
    saved = false

    if (settingsSaveTimeout !== undefined) {
      window.clearTimeout(settingsSaveTimeout)
    }

    settingsSaveTimeout = window.setTimeout(() => {
      settingsSaveTimeout = undefined
      void persistSettings(version)
    }, delay)
  }

  const persistSettings = async (version = ++settingsSaveVersion) => {
    await tick()
    const snapshot = $state.snapshot(settings)

    saving = true
    saved = false
    error = ''
    try {
      await saveSettings(snapshot)
      if (version !== settingsSaveVersion) {
        return
      }

      selectedTemplateId = snapshot.selectedTemplateId
      saved = true

      if (savedResetTimeout !== undefined) {
        window.clearTimeout(savedResetTimeout)
      }

      savedResetTimeout = window.setTimeout(() => {
        if (version === settingsSaveVersion) {
          saved = false
        }
        savedResetTimeout = undefined
      }, 1600)
    } catch (currentError) {
      if (version === settingsSaveVersion) {
        error = currentError instanceof Error ? currentError.message : String(currentError)
      }
    } finally {
      if (version === settingsSaveVersion) {
        saving = false
      }
    }
  }

  const persistSettingsNow = () => {
    if (settingsSaveTimeout !== undefined) {
      window.clearTimeout(settingsSaveTimeout)
      settingsSaveTimeout = undefined
    }

    void persistSettings()
  }

  const persistSelectedTemplate = () => {
    settings.selectedTemplateId = selectedTemplateId
    scheduleSettingsSave(0)
  }
</script>

{#if expanded}
  <main class="window">
    <header class="header">
      <div>
        <p class="eyebrow">Bilibili Copilot</p>
        <h1>{settingsOpen ? '设置' : viewMode === 'history' ? '历史记录' : viewMode === 'prompt-manager' ? 'Prompt 管理' : '字幕总结'}</h1>
      </div>
      <div class="header-actions">
        {#if settingsOpen}
          <button class="ghost" type="button" onclick={openCurrentView}>返回</button>
        {:else if viewMode === 'history' || viewMode === 'prompt-manager'}
          <button class="ghost" type="button" onclick={openCurrentView}>返回</button>
        {:else}
          <button class="ghost" type="button" onclick={openHistory}>历史</button>
          {#if currentThread?.entries.length}
            <button class="ghost" type="button" onclick={startNewConversation}>新对话</button>
          {/if}
          <button class="ghost" type="button" onclick={() => { settingsOpen = true }}>
            设置
          </button>
        {/if}
        <button class="close" type="button" aria-label="收起" onclick={() => { expanded = false }}>×</button>
      </div>
    </header>

    {#if settingsOpen}
      <form
        class="content settings"
        autocomplete="off"
        oninput={() => { scheduleSettingsSave() }}
        onchange={() => { scheduleSettingsSave(0) }}
        onsubmit={(event) => { event.preventDefault(); persistSettingsNow() }}
      >
        <section class="settings-section" aria-labelledby="settings-ai-title">
          <h2 id="settings-ai-title">AI 接入</h2>

          <div class="sponsor-entry">
            <div>
              <strong>邀请奖励：0-0 AI-API 中转平台</strong>
              <p>Gemini/Claude/GPT 最高 0.1 折优惠，邀请码 75RRBBR3，首充双方获得 25% 返利。</p>
            </div>
            <a href="https://0-0.pro/register?ref=75RRBBR3" target="_blank" rel="noreferrer">注册</a>
          </div>

          <label>
            <span>API Base URL</span>
            <input bind:value={settings.apiBaseUrl} placeholder="https://api.openai.com/v1" />
          </label>

          <label>
            <span>API Key</span>
            <input
              bind:value={settings.apiKey}
              type="password"
              autocomplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              placeholder="sk-..."
            />
          </label>

          <label>
            <span>模型</span>
            <input bind:value={settings.model} placeholder="gpt-4.1-mini" />
          </label>

          <label>
            <span>默认字幕语言</span>
            <input bind:value={settings.language} placeholder="zh-CN" />
          </label>
        </section>

        <section class="settings-section" aria-labelledby="settings-behavior-title">
          <h2 id="settings-behavior-title">自动化</h2>

          <label class="check">
            <input bind:checked={settings.includeTimestamps} type="checkbox" />
            <span>发送字幕时保留时间戳</span>
          </label>

          <label class="check">
            <input bind:checked={settings.autoSummaryEnabled} type="checkbox" />
            <span>自动总结新打开的视频</span>
          </label>

          <label class="check">
            <input bind:checked={settings.autoCaptureAiImages} type="checkbox" />
            <span>自动获取 AI 建议图片</span>
          </label>
        </section>

        <details class="settings-group">
          <summary>
            <span class="settings-group-title">分享与发布</span>
            <span class="settings-group-note">Telegraph、Cloudinary、Telegram</span>
          </summary>

          <div class="settings-group-body">
            <details class="settings-subgroup">
              <summary>
                <span class="settings-group-title">Telegraph 页面</span>
                <span class="settings-group-note">账号、作者与打开方式</span>
              </summary>

              <div class="settings-group-body">
                <label>
                  <span>Telegraph Access Token</span>
                  <input
                    bind:value={settings.telegraphAccessToken}
                    type="password"
                    autocomplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="Auto-created on first share"
                  />
                </label>

                <label>
                  <span>Telegraph Short Name</span>
                  <input bind:value={settings.telegraphShortName} placeholder="bilibili-copilot" />
                </label>

                <label>
                  <span>Telegraph Author Name</span>
                  <input bind:value={settings.telegraphAuthorName} placeholder="Bilibili Copilot" />
                </label>

                <label>
                  <span>Telegraph Author URL</span>
                  <input bind:value={settings.telegraphAuthorUrl} placeholder="https://..." />
                </label>

                <label class="check">
                  <input bind:checked={settings.telegraphAutoOpenAfterShare} type="checkbox" />
                  <span>分享完成后自动打开 Telegraph 页面</span>
                </label>

                {#if settings.telegraphAutoOpenAfterShare}
                  <label class="check">
                    <input bind:checked={settings.telegraphOpenInBackground} type="checkbox" />
                    <span>后台打开 Telegraph 标签页</span>
                  </label>
                {/if}
              </div>
            </details>

            <details class="settings-subgroup">
              <summary>
                <span class="settings-group-title">Cloudinary 图片托管</span>
                <span class="settings-group-note">用于分享含图片的总结</span>
              </summary>

              <div class="settings-group-body">
                <label>
                  <span>Cloudinary Cloud Name</span>
                  <input bind:value={settings.cloudinaryCloudName} placeholder="cloud-name" />
                </label>

                <label>
                  <span>Cloudinary API Key</span>
                  <input bind:value={settings.cloudinaryApiKey} placeholder="api-key" />
                </label>

                <label>
                  <span>Cloudinary API Secret</span>
                  <input
                    bind:value={settings.cloudinaryApiSecret}
                    type="password"
                    autocomplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="api-secret"
                  />
                </label>
              </div>
            </details>

            <details class="settings-subgroup">
              <summary>
                <span class="settings-group-title">Telegram 推送</span>
                <span class="settings-group-note">Bot Token、Chat ID 与自动发送</span>
              </summary>

              <div class="settings-group-body">
                <label class="check">
                  <input bind:checked={settings.telegramAutoSendEnabled} type="checkbox" />
                  <span>自动发送到 Telegram</span>
                </label>

                {#if settings.telegramAutoSendEnabled}
                  <label>
                    <span>Telegram Bot Token</span>
                    <input
                      bind:value={settings.telegramBotToken}
                      type="password"
                      autocomplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder="123456:ABC-..."
                    />
                  </label>

                  <label>
                    <span>Telegram Chat ID</span>
                    <input bind:value={settings.telegramChatId} placeholder="-1001234567890" />
                  </label>
                {/if}
              </div>
            </details>
          </div>
        </details>

        {#if saving}
          <p class="saved">自动保存中...</p>
        {:else if saved}
          <p class="saved">设置已自动保存。</p>
        {/if}
      </form>
    {:else if viewMode === 'prompt-manager'}
      <section
        class="content prompt-manager"
      >
        <section class="prompt-section" aria-labelledby="built-in-prompts-title">
          <div class="prompt-section-header">
            <h2 id="built-in-prompts-title">系统内置 Prompt</h2>
            <span>{defaultTemplates.length} 个</span>
          </div>

          <div class="prompt-list">
            {#each defaultTemplates as template (template.id)}
              <details class="prompt-card">
                <summary>
                  <span class="prompt-title">{template.name}</span>
                  <span class="prompt-description">{template.description}</span>
                </summary>
                <textarea readonly value={template.instruction} aria-label={`${template.name} 内容`}></textarea>
              </details>
            {/each}
          </div>
        </section>

        <section class="prompt-section" aria-labelledby="custom-prompts-title">
          <div class="prompt-section-header">
            <div>
              <h2 id="custom-prompts-title">自定义 Prompt</h2>
              <p>新增的大纲会出现在主界面的 Prompt 下拉框中。</p>
            </div>
            <button class="secondary" type="button" onclick={addCustomPromptTemplate}>新增</button>
          </div>

          {#if settings.customPromptTemplates.length === 0}
            <div class="empty compact">
              <h2>还没有自定义 Prompt</h2>
              <p>点击新增后填写名称、说明和完整 Prompt 内容。</p>
            </div>
          {:else}
            <div class="prompt-list">
              {#each settings.customPromptTemplates as template (template.id)}
                <article class="prompt-card prompt-card-editable">
                  <label>
                    <span>名称</span>
                    <input
                      value={template.name}
                      placeholder="例如：论文式大纲"
                      oninput={(event) => { updateCustomPromptTemplate(template.id, 'name', event.currentTarget.value) }}
                    />
                  </label>

                  <label>
                    <span>说明</span>
                    <input
                      value={template.description}
                      placeholder="这个 Prompt 的用途"
                      oninput={(event) => { updateCustomPromptTemplate(template.id, 'description', event.currentTarget.value) }}
                    />
                  </label>

                  <label>
                    <span>Prompt 内容</span>
                    <textarea
                      value={template.instruction}
                      placeholder="写入你希望 AI 遵循的大纲格式和约束"
                      oninput={(event) => { updateCustomPromptTemplate(template.id, 'instruction', event.currentTarget.value) }}
                    ></textarea>
                  </label>

                  <div class="prompt-card-actions">
                    <button class="secondary danger" type="button" onclick={() => { deleteCustomPromptTemplate(template.id) }}>删除</button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        {#if saving}
          <p class="saved">自动保存中...</p>
        {:else if saved}
          <p class="saved">Prompt 已自动保存。</p>
        {/if}
      </section>
    {:else if viewMode === 'history'}
      <section class="content history-view">
        {#if historyLoading}
          <div class="empty">
            <h2>历史记录</h2>
            <p>正在读取历史记录...</p>
          </div>
        {:else if historyThreads.length === 0}
          <div class="empty">
            <h2>历史记录</h2>
            <p>还没有保存的总结和聊天。</p>
          </div>
        {:else}
          <div class="history-list">
            {#each historyThreads as thread (thread.id)}
              <article class="history-item">
                <button class="history-open" type="button" onclick={() => { void selectHistoryThread(thread.id) }}>
                  <strong>{thread.video.title}</strong>
                  <span>BV: {thread.video.bvid} · P{thread.video.page} · {thread.entryCount} 条记录</span>
                  <span>{formatDateTime(thread.updatedAt)}</span>
                </button>
                <button class="history-delete" type="button" onclick={() => { void deleteHistory(thread.id) }}>删除</button>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <section class="content">
        {#if video}
          <div class="video-block">
            <p class="label">当前视频</p>
            <h2>{video.title}</h2>
            <p class="meta">BV: {video.bvid} · P{video.page} · CID: {video.cid}</p>
          </div>
        {:else}
          <div class="empty">
            <h2>当前视频</h2>
            <p>{loading ? '正在读取字幕...' : '点击刷新读取当前页面字幕。'}</p>
          </div>
        {/if}

        {#if subtitle?.available}
          <div class="subtitle-status">
            <div class="subtitle-picker">
              <label>
                <span class="label">字幕</span>
                <select
                  value={subtitle.selected?.lan ?? selectedSubtitleLanguage}
                  aria-label="选择字幕语言"
                  onchange={selectSubtitleLanguage}
                  disabled={loading}
                >
                  {#each subtitle.subtitles as item (item.id_str || item.id)}
                    <option value={item.lan}>{formatSubtitleOption(item)}</option>
                  {/each}
                </select>
              </label>
            </div>
            <div class="subtitle-actions">
              <span>{subtitle.body.length} 条</span>
              <button class="secondary" type="button" onclick={refreshSubtitle} disabled={loading}>刷新字幕</button>
            </div>
          </div>
        {:else if subtitle}
          <div class="notice subtitle-notice">
            <span>{subtitle.reason}</span>
            <button class="secondary" type="button" onclick={refreshSubtitle} disabled={loading}>刷新字幕</button>
          </div>
        {/if}

        <div class="toolbar">
          <select bind:value={selectedTemplateId} aria-label="选择模板" onchange={persistSelectedTemplate}>
            {#each promptTemplates as template (template.id)}
              <option value={template.id}>{template.name}</option>
            {/each}
          </select>
          <button class="secondary" type="button" onclick={openPromptManager}>编辑</button>
        </div>

        <button class="primary" type="button" onclick={summarize} disabled={loading}>
          {loading ? '处理中...' : '开始总结'}
        </button>

        {#if currentThread?.entries.length}
          <div class="export-panel">
            <label class="check">
              <input bind:checked={exportKeepTimestamps} type="checkbox" />
              <span>导出时保留时间戳</span>
            </label>
            <label class="check">
              <input bind:checked={exportKeepImageTags} type="checkbox" />
              <span>导出时保留 image 标签</span>
            </label>
            <button class="secondary export-button" type="button" onclick={exportSummaryZip} disabled={exporting || loading || !video}>
              {exporting ? '导出中...' : '导出 ZIP'}
            </button>
            <button class="secondary export-button" type="button" onclick={shareSummaryToTelegraph} disabled={sharing || loading || !video}>
              {sharing ? '分享中...' : '分享到 Telegraph'}
            </button>
            {#if sharedUrl}
              <div class="share-actions">
                <a class="share-link" href={sharedUrl} target="_blank" rel="noreferrer">打开 Telegraph 标签页</a>
                <button class="secondary share-copy" type="button" onclick={copySharedUrl}>
                  {sharedCopied ? '已复制' : '复制链接'}
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        {#if currentThread?.entries.length}
          <div class="conversation">
            {#each currentThread.entries as entry (entry.id)}
              {#if entry.kind === 'summary'}
                <article class="summary">
                  <p class="label">AI 总结</p>
                  <MarkdownView
                    markdown={entry.content}
                    autoCaptureAiImages={settings.autoCaptureAiImages}
                    onSeek={seekVideo}
                    onCaptureFrame={captureVideoFrame}
                    onGetCurrentSeconds={getCurrentVideoSeconds}
                    onImagesChange={(snapshot) => { handleEntryImagesChange(entry.id, snapshot) }}
                    initialImages={entry.images}
                  />
                </article>
              {:else if entry.role === 'user'}
                <article class="chat-message user-message">
                  <p class="label">我</p>
                  <p>{entry.content}</p>
                </article>
              {:else}
                <article class="chat-message assistant-message">
                  <p class="label">AI 回答</p>
                  <MarkdownView
                    markdown={entry.content}
                    autoCaptureAiImages={settings.autoCaptureAiImages}
                    onSeek={seekVideo}
                    onCaptureFrame={captureVideoFrame}
                    onGetCurrentSeconds={getCurrentVideoSeconds}
                    onImagesChange={(snapshot) => { handleEntryImagesChange(entry.id, snapshot) }}
                    initialImages={entry.images}
                  />
                </article>
              {/if}
            {/each}

            <form class="chat-composer" onsubmit={(event) => { event.preventDefault(); void askQuestion() }}>
              <textarea
                bind:value={chatInput}
                placeholder="继续追问这个视频..."
                rows="3"
                disabled={chatLoading || loading}
              ></textarea>
              <button class="primary" type="submit" disabled={chatLoading || loading || !chatInput.trim()}>
                {chatLoading ? '回答中...' : '发送'}
              </button>
            </form>
          </div>
        {:else if loading}
          <article class="summary pending">
            <p class="label">AI 输出</p>
            <p>正在生成 Markdown 总结...</p>
          </article>
        {/if}
      </section>
    {/if}
  </main>
{:else}
  <button class="launcher" type="button" onclick={openPanel}>
    <span class="mark"></span>
    <span>总结</span>
  </button>
{/if}
