<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from 'wxt/browser'
  import { defaultTemplates } from '../../src/lib/ai/prompts'
  import { extractBvidFromUrl, extractPageFromUrl, stripBilibiliTitleSuffix } from '../../src/lib/bilibili/video'
  import { createZipBlob, type ZipFile } from '../../src/lib/export/zip'
  import { parseConstrainedMarkdown, type InlinePart, type MarkdownBlock } from '../../src/lib/markdown/parse'
  import type { RuntimeMessage, RuntimeResponse, StreamPortEvent } from '../../src/lib/messages'
  import { defaultSettings, loadSettings, saveSettings } from '../../src/lib/settings/storage'
  import type { CopilotSettings, DetectedVideo, PromptTemplate, ResolvedVideo, SubtitleForAI } from '../../src/lib/types'
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
  let subtitleLoading = $state(false)
  let summaryLoading = $state(false)
  let loading = $derived(subtitleLoading || summaryLoading)
  let saving = $state(false)
  let saved = $state(false)
  let exporting = $state(false)
  let sharing = $state(false)
  let sharedUrl = $state('')
  let error = $state('')
  let settings = $state<CopilotSettings>({ ...defaultSettings })
  let exportKeepTimestamps = $state(true)
  let exportKeepImageTags = $state(false)
  let exportImages = $state<ExportImageSnapshot>({
    images: {},
    deletedImageKeys: {},
  })

  let lastUrl = ''
  let intervalId: number | undefined
  let streamPort = $state<ReturnType<typeof browser.runtime.connect> | null>(null)
  let subtitleRequestId = 0

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
      browser.runtime.onMessage.removeListener(messageListener)
      closeStream()
    }
  })

  const initialize = async () => {
    settings = await loadSettings()
    selectedTemplateId = settings.defaultTemplateId
    handleUrlChange()
  }

  const handleUrlChange = () => {
    lastUrl = location.href
    video = null
    subtitle = null
    summary = ''
    exportImages = {
      images: {},
      deletedImageKeys: {},
    }
    error = ''
    closeStream()
    summaryLoading = false
    subtitleRequestId += 1
    subtitleLoading = false

    const detected = detectVideo()
    if (detected.bvid) {
      void browser.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        video: detected,
      })
    }

    if (detected.bvid) {
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

  const openPanel = () => {
    expanded = true
    settingsOpen = false
    if (!video && !subtitle) {
      void ensureSubtitleLoaded()
    }
  }

  const refreshSubtitle = async (forceOrEvent: boolean | Event = true) => {
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
      }) as RuntimeResponse<SubtitlePayload>
      const payload = unwrap(response)
      if (requestId !== subtitleRequestId || requestUrl !== location.href) {
        return
      }
      video = payload.video
      subtitle = payload.subtitle
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
    exportImages = {
      images: {},
      deletedImageKeys: {},
    }
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
        }

        if (message.type === 'SUMMARY_STREAM_DELTA') {
          summary += message.content
        }

        if (message.type === 'SUMMARY_STREAM_DONE') {
          summary = message.summary
          summaryLoading = false
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

  const captureVideoFrame = async (seconds: number) => {
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

      await seekTo(player, seconds)

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
      return
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
  }

  const exportSummaryZip = () => {
    if (!summary) {
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
    if (!summary || !video) {
      return
    }

    sharing = true
    sharedUrl = ''
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'SHARE_SUMMARY_TO_TELEGRAPH',
        video,
        summary,
        images: $state.snapshot(exportImages),
      }) as RuntimeResponse<{ url: string }>
      const payload = unwrap(response)
      sharedUrl = payload.url
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      sharing = false
    }
  }

  const handleExportImagesChange = (snapshot: ExportImageSnapshot) => {
    exportImages = snapshot
  }

  const buildExportFiles = (): ZipFile[] => {
    const assets: ZipFile[] = []
    const assetPaths = new Map<string, string>()
    const blocks = parseConstrainedMarkdown(summary)
    const sections: string[] = []

    blocks.forEach((block, index) => {
      const lines = renderExportBlock(block, blocks, index, assets, assetPaths)
      if (lines.length > 0) {
        sections.push(lines.join('\n'))
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
  ) => {
    if (block.type === 'heading') {
      const heading = `${'#'.repeat(block.level)} ${renderInlineParts(block.parts)}`
      const lines = heading.trim() ? [heading] : []

      if (block.level > 1) {
        const imageKey = createHeadingImageKey(block.parts)
        if (imageKey && !hasFollowingExportImageBlock(blocks, index, imageKey)) {
          lines.push(...renderImageReference(imageKey, '', assets, assetPaths))
        }
      }

      return lines
    }

    if (block.type === 'list') {
      return block.items
        .map(item => renderInlineParts(item))
        .filter(Boolean)
        .map(item => `- ${item}`)
    }

    if (block.type === 'image') {
      const imageKey = createImageKeyForExportBlock(blocks, index)
      return renderImageReference(imageKey, block.label, assets, assetPaths)
    }

    const paragraph = renderInlineParts(block.parts)
    return paragraph ? [paragraph] : []
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
  ) => {
    if (exportImages.deletedImageKeys[key]) {
      return []
    }

    const image = exportImages.images[key]
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

  const persistSettings = async () => {
    saving = true
    saved = false
    error = ''
    try {
      await saveSettings($state.snapshot(settings))
      selectedTemplateId = settings.defaultTemplateId
      saved = true
      window.setTimeout(() => {
        saved = false
      }, 1600)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      saving = false
    }
  }
</script>

{#if expanded}
  <main class="window">
    <header class="header">
      <div>
        <p class="eyebrow">Bilibili Copilot</p>
        <h1>{settingsOpen ? '设置' : '字幕总结'}</h1>
      </div>
      <div class="header-actions">
        <button class="ghost" type="button" onclick={() => { settingsOpen = !settingsOpen }}>
          {settingsOpen ? '返回' : '设置'}
        </button>
        <button class="close" type="button" aria-label="收起" onclick={() => { expanded = false }}>×</button>
      </div>
    </header>

    {#if settingsOpen}
      <form
        class="content settings"
        autocomplete="off"
        onsubmit={(event) => { event.preventDefault(); void persistSettings() }}
      >
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

        <label>
          <span>默认模板</span>
          <select bind:value={settings.defaultTemplateId}>
            {#each defaultTemplates as template (template.id)}
              <option value={template.id}>{template.name}</option>
            {/each}
          </select>
        </label>

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

        {#if saved}
          <p class="saved">设置已保存。</p>
        {/if}

        <button class="primary" type="submit" disabled={saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </form>
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
            <div>
              <p class="label">字幕</p>
              <strong>{subtitle.selected?.lan_doc ?? subtitle.selected?.lan}</strong>
            </div>
            <span>{subtitle.body.length} 条</span>
          </div>
        {:else if subtitle}
          <div class="notice">{subtitle.reason}</div>
        {/if}

        <div class="toolbar">
          <select bind:value={selectedTemplateId} aria-label="选择模板">
            {#each defaultTemplates as template (template.id)}
              <option value={template.id}>{template.name}</option>
            {/each}
          </select>
          <button class="secondary" type="button" onclick={refreshSubtitle} disabled={loading}>刷新</button>
        </div>

        <button class="primary" type="button" onclick={summarize} disabled={loading}>
          {loading ? '处理中...' : '开始总结'}
        </button>

        {#if summary}
          <div class="export-panel">
            <label class="check">
              <input bind:checked={exportKeepTimestamps} type="checkbox" />
              <span>导出时保留时间戳</span>
            </label>
            <label class="check">
              <input bind:checked={exportKeepImageTags} type="checkbox" />
              <span>导出时保留 image 标签</span>
            </label>
            <button class="secondary export-button" type="button" onclick={exportSummaryZip} disabled={exporting || loading}>
              {exporting ? '导出中...' : '导出 ZIP'}
            </button>
            <button class="secondary export-button" type="button" onclick={shareSummaryToTelegraph} disabled={sharing || loading || !video}>
              {sharing ? 'Sharing...' : 'Share to Telegraph'}
            </button>
            {#if sharedUrl}
              <a class="share-link" href={sharedUrl} target="_blank" rel="noreferrer">Open Telegraph page</a>
            {/if}
          </div>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        {#if summary}
          <article class="summary">
            <p class="label">AI 输出</p>
            <MarkdownView
              markdown={summary}
              autoCaptureAiImages={settings.autoCaptureAiImages}
              onSeek={seekVideo}
              onCaptureFrame={captureVideoFrame}
              onImagesChange={handleExportImagesChange}
            />
          </article>
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
